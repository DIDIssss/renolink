-- MySQL 8.0.17+ / 8.4, InnoDB. DDL fora da transação de importação.
CREATE TABLE IF NOT EXISTS renolink_users (
 id BIGINT PRIMARY KEY, name TEXT NOT NULL, email VARCHAR(254) NOT NULL,
 email_normalized VARCHAR(254) GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
 role VARCHAR(16) NOT NULL, company TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 created_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 UNIQUE KEY users_email_uq (email_normalized),
 CONSTRAINT users_id_ck CHECK (id > 0), CONSTRAINT users_role_ck CHECK (role IN ('creator','company'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_ideas (
 id BIGINT PRIMARY KEY, user_id BIGINT NULL,
 title TEXT NOT NULL, category VARCHAR(100) NOT NULL, problem MEDIUMTEXT NOT NULL, solution MEDIUMTEXT NOT NULL,
 beneficiaries TEXT NOT NULL, participation TEXT NOT NULL, status VARCHAR(100) NOT NULL, potential TEXT NOT NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 UNIQUE KEY ideas_author_uq (id,user_id), KEY ideas_owner_idx (user_id), KEY ideas_status_date_idx (status,updated_at),
 CONSTRAINT ideas_id_ck CHECK (id > 0),
 CONSTRAINT ideas_owner_fk FOREIGN KEY (user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_negotiations (
 id BIGINT PRIMARY KEY, idea_id BIGINT NOT NULL, creator_user_id BIGINT NOT NULL, company_user_id BIGINT NOT NULL,
 status TEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 UNIQUE KEY negotiations_pair_uq (idea_id,company_user_id), KEY negotiations_creator_idx (creator_user_id), KEY negotiations_company_idx (company_user_id),
 CONSTRAINT negotiations_id_ck CHECK (id > 0), CONSTRAINT negotiations_parties_ck CHECK (creator_user_id <> company_user_id),
 CONSTRAINT negotiations_idea_fk FOREIGN KEY (idea_id) REFERENCES renolink_ideas(id) ON DELETE RESTRICT,
 CONSTRAINT negotiations_author_fk FOREIGN KEY (idea_id,creator_user_id) REFERENCES renolink_ideas(id,user_id) ON DELETE RESTRICT,
 CONSTRAINT negotiations_creator_fk FOREIGN KEY (creator_user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT,
 CONSTRAINT negotiations_company_fk FOREIGN KEY (company_user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_messages (
 id BIGINT PRIMARY KEY, from_user_id BIGINT NOT NULL, to_user_id BIGINT NOT NULL, text MEDIUMTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 KEY messages_sender_idx (from_user_id,created_at), KEY messages_recipient_idx (to_user_id,created_at),
 CONSTRAINT messages_id_ck CHECK (id > 0), CONSTRAINT messages_text_ck CHECK (CHAR_LENGTH(TRIM(text)) > 0),
 CONSTRAINT messages_sender_fk FOREIGN KEY (from_user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT,
 CONSTRAINT messages_recipient_fk FOREIGN KEY (to_user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, user_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL, extra JSON NOT NULL,
 KEY sessions_user_idx (user_id), KEY sessions_expiration_idx (revoked_at,expires_at),
 CONSTRAINT sessions_hash_ck CHECK (REGEXP_LIKE(token_hash, '^[a-f0-9]{64}$','c')),
 CONSTRAINT sessions_date_ck CHECK (expires_at >= created_at),
 CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_meta (
 id INT PRIMARY KEY, payload JSON NOT NULL, CONSTRAINT meta_id_ck CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_imports (
 source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, counts JSON NOT NULL,
 imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
