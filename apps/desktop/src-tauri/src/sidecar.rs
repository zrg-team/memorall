use serde::Serialize;

pub const SIDECAR_PROTOCOL_VERSION: u16 = 1;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub protocol_version: u16,
    pub running: bool,
}

#[derive(Default)]
pub struct SidecarSupervisor {
    running: bool,
}

impl SidecarSupervisor {
    pub fn status(&self) -> SidecarStatus {
        SidecarStatus {
            protocol_version: SIDECAR_PROTOCOL_VERSION,
            running: self.running,
        }
    }
}
