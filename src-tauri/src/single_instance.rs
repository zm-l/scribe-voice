#[cfg(windows)]
mod win {
    use windows::{
        core::{w, PCWSTR},
        Win32::{
            Foundation::{
                CloseHandle, GetLastError, SetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS,
                HANDLE,
            },
            System::Threading::CreateMutexW,
            UI::WindowsAndMessaging::{
                FindWindowW, MessageBoxW, SetForegroundWindow, ShowWindow, MB_ICONERROR,
                MB_ICONINFORMATION, MB_OK, SW_RESTORE,
            },
        },
    };
    pub struct Guard(HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    fn acquire_named(name: &str) -> Result<Option<Guard>, String> {
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        unsafe {
            SetLastError(ERROR_SUCCESS);
            let handle = CreateMutexW(None, false, PCWSTR(name.as_ptr()))
                .map_err(|e| format!("Could not establish the Scribe instance guard: {e}"))?;
            let exists = GetLastError() == ERROR_ALREADY_EXISTS;
            let guard = Guard(handle);
            if exists {
                drop(guard);
                Ok(None)
            } else {
                Ok(Some(guard))
            }
        }
    }
    fn focus_existing() {
        unsafe {
            if let Ok(window) = FindWindowW(PCWSTR::null(), w!("Scribe Voice")) {
                let _ = ShowWindow(window, SW_RESTORE);
                let _ = SetForegroundWindow(window);
            }
        }
    }
    pub fn enter() -> Result<Option<Guard>, String> {
        let Some(guard) = acquire_named("Local\\dev.scribe.voice.single-instance.v1")? else {
            focus_existing();
            return Ok(None);
        };
        // Old MVP executables predate the mutex. Do not silently run alongside them.
        let legacy_exists = unsafe { FindWindowW(PCWSTR::null(), w!("Scribe Voice")).is_ok() };
        if legacy_exists {
            // This warning process owns no app/hotkey; do not block a later clean launch.
            drop(guard);
            focus_existing();
            unsafe {
                MessageBoxW(None, w!("Another Scribe Voice copy is already running.\n\nQuit older copies through each tray icon's Quit menu, and stop any development terminal with Ctrl+C. Then open the updated app again. Closing a window with X only hides it to the tray.\n\nNo recording or other app has been stopped automatically."), w!("Scribe Voice - existing copy detected"), MB_OK | MB_ICONINFORMATION);
            }
            return Ok(None);
        }
        Ok(Some(guard))
    }
    pub fn show_error(message: &str) {
        let message: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                None,
                PCWSTR(message.as_ptr()),
                w!("Scribe Voice"),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn duplicate_instance_cannot_claim_the_guard_and_exit_releases_it() {
            let name = format!("Local\\ScribeVoice.test.{}", std::process::id());
            let first = acquire_named(&name).unwrap().unwrap();
            assert!(acquire_named(&name).unwrap().is_none());
            drop(first);
            assert!(acquire_named(&name).unwrap().is_some());
        }
    }
}
#[cfg(windows)]
pub use win::{enter, show_error};
#[cfg(not(windows))]
pub fn enter() -> Result<Option<()>, String> {
    Ok(Some(()))
}
#[cfg(not(windows))]
pub fn show_error(message: &str) {
    eprintln!("{message}");
}
