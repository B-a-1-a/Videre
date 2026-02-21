use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub code: String,
    pub message: String,
}

impl ErrorEnvelope {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_input".to_string(),
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "not_found".to_string(),
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "internal".to_string(),
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for ErrorEnvelope {
    fn from(value: anyhow::Error) -> Self {
        Self::internal(value.to_string())
    }
}

impl From<std::io::Error> for ErrorEnvelope {
    fn from(value: std::io::Error) -> Self {
        Self::internal(value.to_string())
    }
}

impl From<rusqlite::Error> for ErrorEnvelope {
    fn from(value: rusqlite::Error) -> Self {
        Self::internal(value.to_string())
    }
}

impl From<serde_json::Error> for ErrorEnvelope {
    fn from(value: serde_json::Error) -> Self {
        Self::internal(value.to_string())
    }
}

pub type AppResult<T> = Result<T, ErrorEnvelope>;
