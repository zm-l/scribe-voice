use tauri_plugin_global_shortcut::{GlobalShortcut, Shortcut};

pub trait Registry {
    fn owns(&self, key: Shortcut) -> bool;
    fn install(&self, key: Shortcut) -> Result<(), String>;
    fn remove(&self, key: Shortcut) -> Result<(), String>;
}
impl<R: tauri::Runtime> Registry for GlobalShortcut<R> {
    fn owns(&self, key: Shortcut) -> bool {
        self.is_registered(key)
    }
    fn install(&self, key: Shortcut) -> Result<(), String> {
        self.register(key).map_err(|_| "The chosen shortcut could not be registered. Another app or Scribe copy may be using it.".into())
    }
    fn remove(&self, key: Shortcut) -> Result<(), String> {
        self.unregister(key)
            .map_err(|_| "The previous shortcut could not be released.".into())
    }
}

// No controller/state mutex may be held here: Tauri dispatches registration to its main thread.
// A blocked candidate never releases the old key; a failed persistence operation rolls back.
pub fn rebind<R: Registry>(
    registry: &R,
    previous: Option<Shortcut>,
    next: Shortcut,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let created = !registry.owns(next);
    if created {
        registry.install(next)?;
    }
    let previous_to_remove = previous.filter(|old| *old != next && registry.owns(*old));
    if let Some(old) = previous_to_remove {
        if let Err(error) = registry.remove(old) {
            if created && registry.remove(next).is_err() {
                return Err(format!("{error} The candidate could not be cleaned up; restart Scribe before retrying."));
            }
            return Err(error);
        }
    }
    if let Err(error) = persist() {
        let mut rollback_failed = false;
        if let Some(old) = previous_to_remove {
            rollback_failed |= registry.install(old).is_err();
        }
        if created {
            rollback_failed |= registry.remove(next).is_err();
        }
        return Err(if rollback_failed {
            format!("Could not save settings: {error}. Shortcut rollback was incomplete; restart Scribe or choose a new combination.")
        } else {
            format!("Could not save settings: {error}. The previous binding was preserved.")
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashSet,
        str::FromStr,
    };
    #[derive(Default)]
    struct Fake {
        owned: RefCell<HashSet<u32>>,
        blocked: RefCell<HashSet<u32>>,
        installs: Cell<usize>,
    }
    impl Registry for Fake {
        fn owns(&self, key: Shortcut) -> bool {
            self.owned.borrow().contains(&key.id())
        }
        fn install(&self, key: Shortcut) -> Result<(), String> {
            self.installs.set(self.installs.get() + 1);
            if self.blocked.borrow().contains(&key.id()) {
                return Err("unavailable".into());
            }
            if !self.owned.borrow_mut().insert(key.id()) {
                return Err("duplicate registration".into());
            }
            Ok(())
        }
        fn remove(&self, key: Shortcut) -> Result<(), String> {
            self.owned.borrow_mut().remove(&key.id());
            Ok(())
        }
    }
    fn key(value: &str) -> Shortcut {
        Shortcut::from_str(value).unwrap()
    }
    #[test]
    fn same_owned_key_is_not_registered_twice() {
        let r = Fake::default();
        let k = key("Ctrl+Shift+G");
        r.install(k).unwrap();
        rebind(&r, Some(k), k, || Ok(())).unwrap();
        assert_eq!(r.installs.get(), 1);
        assert!(r.owns(k));
    }
    #[test]
    fn unavailable_candidate_preserves_previous_key_and_never_saves() {
        let r = Fake::default();
        let a = key("Ctrl+Shift+G");
        let b = key("Ctrl+Shift+T");
        r.install(a).unwrap();
        r.blocked.borrow_mut().insert(b.id());
        let saved = Cell::new(false);
        assert!(rebind(&r, Some(a), b, || {
            saved.set(true);
            Ok(())
        })
        .is_err());
        assert!(r.owns(a));
        assert!(!r.owns(b));
        assert!(!saved.get());
    }
    #[test]
    fn successful_change_releases_old_key_and_owns_new_key() {
        let r = Fake::default();
        let a = key("Ctrl+Shift+G");
        let b = key("Ctrl+Shift+T");
        r.install(a).unwrap();
        rebind(&r, Some(a), b, || Ok(())).unwrap();
        assert!(!r.owns(a));
        assert!(r.owns(b));
    }
    #[test]
    fn persistence_failure_restores_the_previous_binding() {
        let r = Fake::default();
        let a = key("Ctrl+Shift+G");
        let b = key("Ctrl+Shift+T");
        r.install(a).unwrap();
        assert!(rebind(&r, Some(a), b, || Err("disk failure".into())).is_err());
        assert!(r.owns(a));
        assert!(!r.owns(b));
    }
    #[test]
    fn saving_after_failed_startup_must_actually_register_the_key() {
        let r = Fake::default();
        let k = key("Ctrl+Shift+G");
        r.blocked.borrow_mut().insert(k.id());
        assert!(rebind(&r, Some(k), k, || Ok(())).is_err());
        r.blocked.borrow_mut().clear();
        rebind(&r, Some(k), k, || Ok(())).unwrap();
        assert!(r.owns(k));
    }
    #[test]
    fn failed_persistence_cleans_up_a_newly_recovered_startup_binding() {
        let r = Fake::default();
        let k = key("Ctrl+Shift+G");
        assert!(rebind(&r, Some(k), k, || Err("disk failure".into())).is_err());
        assert!(!r.owns(k));
    }
}
