use std::{thread, time::Duration};
#[derive(Clone, Debug)]
pub struct Target {
    pub window: isize,
    pub focus: isize,
    pub process_id: u32,
    pub app: String,
    pub blocked: bool,
    pub runtime_id: Option<Vec<i32>>,
}

pub fn copy(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| format!("Clipboard unavailable: {e}"))?
        .set_text(text.to_string())
        .map_err(|e| format!("Cannot copy text: {e}"))
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::PWSTR;
    use windows::Win32::{
        Foundation::CloseHandle,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            DataExchange::GetClipboardSequenceNumber,
            Ole::{SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound},
            Threading::{
                GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Accessibility::{CUIAutomation, IUIAutomation},
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
            },
            WindowsAndMessaging::{
                GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongW,
                GetWindowThreadProcessId, GUITHREADINFO, GWL_STYLE,
            },
        },
    };
    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }
    // Store only the UIA runtime identity and password flag, never field text or accessible names.
    fn focused_identity() -> Option<(Vec<i32>, bool)> {
        unsafe {
            let result = CoInitializeEx(None, COINIT_MULTITHREADED);
            if result.is_err() && result.0 as u32 != 0x80010106 {
                return None;
            }
            let _guard = ComGuard(result.is_ok());
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let element = automation.GetFocusedElement().ok()?;
            let password = element.CurrentIsPassword().ok()?.as_bool();
            let array = element.GetRuntimeId().ok()?;
            if array.is_null() {
                return None;
            }
            let read = (|| {
                let lower = SafeArrayGetLBound(array, 1).ok()?;
                let upper = SafeArrayGetUBound(array, 1).ok()?;
                if upper < lower || upper - lower > 64 {
                    return None;
                }
                let mut ids = Vec::new();
                for i in lower..=upper {
                    let mut value = 0i32;
                    SafeArrayGetElement(array, &i, &mut value as *mut i32 as *mut std::ffi::c_void)
                        .ok()?;
                    ids.push(value);
                }
                Some((ids, password))
            })();
            let _ = SafeArrayDestroy(array);
            read
        }
    }
    fn app_name(pid: u32) -> String {
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buffer = vec![0u16; 1024];
                let mut len = buffer.len() as u32;
                let result = QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut len,
                );
                let _ = CloseHandle(handle);
                if result.is_ok() {
                    let path = String::from_utf16_lossy(&buffer[..len as usize]);
                    return path
                        .rsplit('\\')
                        .next()
                        .unwrap_or("Application")
                        .to_string();
                }
            }
            "Unknown application".into()
        }
    }
    pub fn capture() -> Option<Target> {
        unsafe {
            let window = GetForegroundWindow();
            if window.0.is_null() {
                return None;
            }
            let mut pid = 0;
            let thread_id = GetWindowThreadProcessId(window, Some(&mut pid));
            let mut gui = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            if GetGUIThreadInfo(thread_id, &mut gui).is_err() {
                return None;
            }
            let app = app_name(pid);
            let mut class = [0u16; 128];
            let len = GetClassNameW(gui.hwndFocus, &mut class);
            let legacy_password = len > 0
                && String::from_utf16_lossy(&class[..len as usize]).eq_ignore_ascii_case("Edit")
                && GetWindowLongW(gui.hwndFocus, GWL_STYLE) & 0x20 != 0;
            let identity = focused_identity();
            let password = identity.as_ref().is_some_and(|(_, password)| *password);
            let unsafe_app = [
                "windowsterminal.exe",
                "cmd.exe",
                "powershell.exe",
                "pwsh.exe",
                "wsl.exe",
                "bash.exe",
                "mintty.exe",
                "conhost.exe",
            ]
            .contains(&app.to_lowercase().as_str());
            // Unknown/inaccessible UIA targets are copy-only. This is deliberately conservative.
            let blocked = pid == GetCurrentProcessId()
                || legacy_password
                || password
                || unsafe_app
                || gui.hwndFocus.0.is_null()
                || identity.is_none();
            Some(Target {
                window: window.0 as isize,
                focus: gui.hwndFocus.0 as isize,
                process_id: pid,
                blocked,
                app,
                runtime_id: identity.map(|(id, _)| id),
            })
        }
    }
    pub fn unchanged(target: &Target) -> bool {
        capture().is_some_and(|now| {
            !now.blocked
                && now.window == target.window
                && now.focus == target.focus
                && now.process_id == target.process_id
                && now.runtime_id == target.runtime_id
        })
    }
    fn modifiers_up() -> bool {
        unsafe {
            [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
                .iter()
                .all(|k| GetAsyncKeyState(k.0 as i32) >= 0)
        }
    }
    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(vk),
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    ..Default::default()
                },
            },
        }
    }
    pub fn paste(target: &Target, text: &str) -> Result<(), String> {
        if target.blocked {
            return Err("This target is protected, a terminal, or cannot be safely identified. Automatic insertion is disabled; copy your result manually.".into());
        }
        for _ in 0..30 {
            if modifiers_up() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if !modifiers_up() {
            return Err("Release the shortcut keys, then copy your result.".into());
        }
        if !unchanged(target) {
            return Err("The input focus changed. Text was kept here instead of pasted into an uncertain target.".into());
        }
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|_| "Clipboard is unavailable. Your text is preserved.".to_string())?;
        let previous = clipboard.get_text().ok();
        clipboard
            .set_text(text.to_string())
            .map_err(|_| "Could not write to the clipboard. Your text is preserved.".to_string())?;
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if !unchanged(target) {
            restore_previous(previous, sequence);
            return Err("Focus changed before insertion. Your text is preserved.".into());
        }
        let inputs = [
            key(VK_CONTROL.0, false),
            key(0x56, false),
            key(VK_CONTROL.0, true),
            key(0x56, true),
        ];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        restore_previous(previous, sequence);
        if sent != inputs.len() as u32 {
            return Err("Windows blocked simulated paste. Elevated or protected apps may not support it; copy the result manually.".into());
        }
        Ok(())
    }
    fn restore_previous(previous: Option<String>, sequence: u32) {
        if let Some(text) = previous {
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(1200));
                unsafe {
                    if GetClipboardSequenceNumber() != sequence {
                        return;
                    }
                }
                if let Ok(mut c) = arboard::Clipboard::new() {
                    let _ = c.set_text(text);
                }
            });
        }
    }
}
#[cfg(windows)]
pub use win::{capture, paste};
#[cfg(not(windows))]
pub fn capture() -> Option<Target> {
    None
}
#[cfg(not(windows))]
pub fn paste(_: &Target, _: &str) -> Result<(), String> {
    Err("Automatic insertion is implemented only on Windows in this MVP.".into())
}
