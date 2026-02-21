use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Debug)]
pub struct AppState {
    pub project_roots: Mutex<HashMap<String, PathBuf>>,
    pub render_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project_roots: Mutex::new(HashMap::new()),
            render_cancellations: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_project_root(&self, project_id: String, root: PathBuf) {
        if let Ok(mut roots) = self.project_roots.lock() {
            roots.insert(project_id, root);
        }
    }

    pub fn project_root(&self, project_id: &str) -> Option<PathBuf> {
        self.project_roots
            .lock()
            .ok()
            .and_then(|roots| roots.get(project_id).cloned())
    }

    pub fn set_render_cancel_flag(&self, job_id: String, flag: Arc<AtomicBool>) {
        if let Ok(mut map) = self.render_cancellations.lock() {
            map.insert(job_id, flag);
        }
    }

    pub fn cancel_render(&self, job_id: &str) {
        if let Ok(map) = self.render_cancellations.lock() {
            if let Some(flag) = map.get(job_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn clear_render_cancel_flag(&self, job_id: &str) {
        if let Ok(mut map) = self.render_cancellations.lock() {
            map.remove(job_id);
        }
    }
}
