use anyhow::{anyhow, Result};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
    pub token_type: String,
}

pub fn create_access_token(user_id: Uuid, secret: &str) -> Result<String> {
    let exp = (Utc::now() + Duration::hours(1)).timestamp();
    let claims = Claims { sub: user_id, exp, token_type: "access".into() };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|e| anyhow!(e))
}

pub fn create_refresh_token(user_id: Uuid, secret: &str) -> Result<String> {
    let exp = (Utc::now() + Duration::days(30)).timestamp();
    let claims = Claims { sub: user_id, exp, token_type: "refresh".into() };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|e| anyhow!(e))
}

pub fn verify_token(token: &str, secret: &str, expected_type: &str) -> Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|e| anyhow!(e))?;

    if data.claims.token_type != expected_type {
        return Err(anyhow!("invalid token type"));
    }
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test_secret_exactly_32_chars_long!";

    #[test]
    fn access_token_roundtrip() {
        let id = Uuid::new_v4();
        let token = create_access_token(id, SECRET).unwrap();
        let claims = verify_token(&token, SECRET, "access").unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.token_type, "access");
    }

    #[test]
    fn refresh_token_roundtrip() {
        let id = Uuid::new_v4();
        let token = create_refresh_token(id, SECRET).unwrap();
        let claims = verify_token(&token, SECRET, "refresh").unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.token_type, "refresh");
    }

    #[test]
    fn wrong_token_type_rejected() {
        let id = Uuid::new_v4();
        let token = create_refresh_token(id, SECRET).unwrap();
        assert!(verify_token(&token, SECRET, "access").is_err());
    }

    #[test]
    fn wrong_secret_rejected() {
        let id = Uuid::new_v4();
        let token = create_access_token(id, SECRET).unwrap();
        assert!(verify_token(&token, "different_secret_32_chars_long!!", "access").is_err());
    }

    #[test]
    fn access_and_refresh_have_different_types() {
        let id = Uuid::new_v4();
        let access = create_access_token(id, SECRET).unwrap();
        let refresh = create_refresh_token(id, SECRET).unwrap();
        assert_ne!(access, refresh);
    }
}
