//! Keep the sidecar and its descendants in the desktop app's lifetime.
//! Windows force-termination does not deliver Node exit handlers, so QEMU
//! needs an OS-owned job rather than relying on JavaScript cleanup alone.
#[cfg(windows)]
pub struct ChildProcessJob {
    _handle: std::os::windows::io::OwnedHandle,
}

#[cfg(windows)]
impl ChildProcessJob {
    pub fn attach(pid: u32) -> std::io::Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::{
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        };
        // All handles are owned immediately after a successful Win32 call;
        // every error path closes them and preserves the OS error.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let job = OwnedHandle::from_raw_handle(handle);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let process = OwnedHandle::from_raw_handle(handle);
            if AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(Self { _handle: job })
        }
    }
}

#[cfg(not(windows))]
pub struct ChildProcessJob;

#[cfg(not(windows))]
impl ChildProcessJob {
    pub fn attach(_pid: u32) -> std::io::Result<Self> {
        Ok(Self)
    }
}
