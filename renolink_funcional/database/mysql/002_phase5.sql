-- Incremental e aditiva. Nenhuma tabela existente e alterada ou removida.
CREATE TABLE IF NOT EXISTS renolink_staff (
 user_id BIGINT PRIMARY KEY, access_role VARCHAR(16) NOT NULL, active TINYINT NOT NULL,
 created_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 CONSTRAINT staff_role_ck CHECK (access_role IN ('admin','support')),
 CONSTRAINT staff_active_ck CHECK (active IN (0,1)),
 CONSTRAINT staff_user_fk FOREIGN KEY (user_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_conversations (
 id BIGINT PRIMARY KEY, visitor_id BIGINT NOT NULL UNIQUE, status VARCHAR(20) NOT NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 CONSTRAINT conversations_id_ck CHECK (id > 0),
 CONSTRAINT conversations_status_ck CHECK (status IN ('Aberta','Encerrada')),
 CONSTRAINT conversations_visitor_fk FOREIGN KEY (visitor_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_support_messages (
 id BIGINT PRIMARY KEY, conversation_id BIGINT NOT NULL, sender_id BIGINT NOT NULL,
 text TEXT NOT NULL, created_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 KEY support_conversation_date_idx (conversation_id,created_at),
 CONSTRAINT support_id_ck CHECK (id > 0),
 CONSTRAINT support_text_ck CHECK (CHAR_LENGTH(TRIM(text)) BETWEEN 1 AND 5000),
 CONSTRAINT support_conversation_fk FOREIGN KEY (conversation_id) REFERENCES renolink_conversations(id) ON DELETE RESTRICT,
 CONSTRAINT support_sender_fk FOREIGN KEY (sender_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_requests (
 id BIGINT PRIMARY KEY, idea_id BIGINT NOT NULL, visitor_id BIGINT NOT NULL,
 status VARCHAR(24) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 UNIQUE KEY requests_pair_uq (idea_id,visitor_id),
 CONSTRAINT requests_id_ck CHECK (id > 0),
 CONSTRAINT requests_status_ck CHECK (status IN ('Solicitada','Em contato','Em negociação','Concluída','Encerrada')),
 CONSTRAINT requests_idea_fk FOREIGN KEY (idea_id) REFERENCES renolink_ideas(id) ON DELETE RESTRICT,
 CONSTRAINT requests_visitor_fk FOREIGN KEY (visitor_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS renolink_audit (
 id BIGINT PRIMARY KEY, actor_id BIGINT NOT NULL, action VARCHAR(80) NOT NULL,
 target_type VARCHAR(24) NOT NULL, target_id BIGINT NOT NULL, detail TEXT NOT NULL,
 created_at DATETIME(3) NOT NULL, extra JSON NOT NULL,
 KEY audit_date_idx (created_at), KEY audit_actor_idx (actor_id),
 CONSTRAINT audit_id_ck CHECK (id > 0 AND target_id > 0),
 CONSTRAINT audit_target_ck CHECK (target_type IN ('idea','conversation','request','negotiation','staff')),
 CONSTRAINT audit_actor_fk FOREIGN KEY (actor_id) REFERENCES renolink_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
