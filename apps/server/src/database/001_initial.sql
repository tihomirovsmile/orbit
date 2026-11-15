CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
 password_hash TEXT, bio TEXT NOT NULL DEFAULT '', avatar TEXT, banner TEXT,
 type TEXT NOT NULL CHECK(type IN ('human','ai')), role TEXT NOT NULL DEFAULT 'USER',
 country TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'ru', privacy TEXT NOT NULL DEFAULT 'everyone',
 verified INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 CHECK(type='human' OR verified=0)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(role) WHERE role='OWNER';
CREATE TABLE IF NOT EXISTS user_languages(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, language TEXT, proficiency TEXT, PRIMARY KEY(user_id,language));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_personas (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, seed TEXT NOT NULL, traits TEXT NOT NULL, interests TEXT NOT NULL,
 writing TEXT NOT NULL, biography TEXT NOT NULL, occupation TEXT NOT NULL, schedule TEXT NOT NULL, goals TEXT NOT NULL,
 emotion TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'OFFLINE', next_action_at INTEGER NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0, model_id TEXT, public_figure TEXT, avatar_style TEXT NOT NULL DEFAULT 'abstract'
);
CREATE TABLE IF NOT EXISTS spaces (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('dm','group','channel')), title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'public', owner_id TEXT NOT NULL REFERENCES users(id),
 invite TEXT NOT NULL UNIQUE, rules TEXT NOT NULL DEFAULT '', frozen INTEGER NOT NULL DEFAULT 0, comments_enabled INTEGER NOT NULL DEFAULT 1,
 verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS space_members (space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT 'member', muted INTEGER NOT NULL DEFAULT 0, last_read_at INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY(space_id,user_id));
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, sender_id TEXT NOT NULL REFERENCES users(id),
 text TEXT NOT NULL, reply_to TEXT REFERENCES messages(id), forwarded_from TEXT REFERENCES messages(id), created_at INTEGER NOT NULL,
 edited_at INTEGER, deleted_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, job_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS messages_space_time ON messages(space_id,created_at);
CREATE TABLE IF NOT EXISTS message_edits (id TEXT PRIMARY KEY, message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS message_reads (message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER, PRIMARY KEY(message_id,user_id));
CREATE TABLE IF NOT EXISTS media_assets (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), filename TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, source TEXT, license TEXT, attribution TEXT, tags TEXT DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS message_media(message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, media_id TEXT REFERENCES media_assets(id), PRIMARY KEY(message_id,media_id));
CREATE TABLE IF NOT EXISTS avatar_history(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,asset_url TEXT NOT NULL,seed TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reactions(message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL, PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE IF NOT EXISTS follows(follower_id TEXT REFERENCES users(id) ON DELETE CASCADE, target_id TEXT REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY(follower_id,target_id));
CREATE TABLE IF NOT EXISTS relationships(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, target_id TEXT REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'acquaintance', strength REAL NOT NULL DEFAULT 0, interactions INTEGER NOT NULL DEFAULT 0, emotion REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,target_id));
CREATE TABLE IF NOT EXISTS blocks(user_id TEXT REFERENCES users(id) ON DELETE CASCADE, target_id TEXT REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(user_id,target_id));
CREATE TABLE IF NOT EXISTS agent_memories(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_id TEXT REFERENCES users(id), kind TEXT NOT NULL, content TEXT NOT NULL, importance REAL NOT NULL DEFAULT 0.5, source_id TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS memory_agent ON agent_memories(user_id,importance,created_at);
CREATE TABLE IF NOT EXISTS agent_activity_logs(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, base_url TEXT NOT NULL, secret TEXT, headers_secret TEXT, timeout INTEGER NOT NULL, retries INTEGER NOT NULL, concurrency INTEGER NOT NULL, trusted_local INTEGER NOT NULL DEFAULT 0, is_primary INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS models(provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(provider_id,id));
CREATE TABLE IF NOT EXISTS model_configurations(task TEXT PRIMARY KEY, provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE, model_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_usage(id TEXT PRIMARY KEY, provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL, model_id TEXT NOT NULL, agent_id TEXT REFERENCES users(id) ON DELETE SET NULL, task TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, reservation REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS usage_time ON token_usage(created_at);
CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY, agent_id TEXT REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, run_at INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL, completed_at INTEGER);
CREATE INDEX IF NOT EXISTS jobs_status_time ON ai_jobs(status,run_at,priority);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, target TEXT, read_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forum_topics(id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forum_replies(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER);
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS moderation_actions(id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ban_appeals(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action_id TEXT NOT NULL REFERENCES moderation_actions(id), topic_id TEXT NOT NULL REFERENCES forum_topics(id), status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled_posts(id TEXT PRIMARY KEY, space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE, author_id TEXT REFERENCES users(id), text TEXT NOT NULL, publish_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
PRAGMA user_version = 1;
