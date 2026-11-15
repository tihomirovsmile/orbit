import type Database from "better-sqlite3";
export function masterUpgrade(db: Database.Database) {
  const add = (table: string, name: string, sql: string) => {
    if (
      !(db.pragma(`table_info(${table})`) as any[]).some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
  };
  db.transaction(() => {
    for (const [name, sql] of Object.entries({
      derived_verified: "INTEGER NOT NULL DEFAULT 0",
      presence_until: "INTEGER NOT NULL DEFAULT 0",
      presence_visibility: "TEXT NOT NULL DEFAULT 'everyone'",
      birth_date: "TEXT",
      permissions: "TEXT NOT NULL DEFAULT '{}'",
      deletion_at: "INTEGER",
      deletion_previous_status: "TEXT",
    }))
      add("users", name, sql);
    for (const [name, sql] of Object.entries({
      verification_type: "TEXT NOT NULL DEFAULT 'none'",
      verification_state: "TEXT NOT NULL DEFAULT 'none'",
      verification_category: "TEXT",
      funding_country: "TEXT",
      delete_at: "INTEGER",
      delete_requested_at: "INTEGER",
      show_author: "INTEGER NOT NULL DEFAULT 0",
      reactions_enabled: "INTEGER NOT NULL DEFAULT 1",
      comments_mode: "TEXT NOT NULL DEFAULT 'none'",
      discussion_id: "TEXT",
      members_visibility: "TEXT NOT NULL DEFAULT 'admins'",
      admins_visibility: "TEXT NOT NULL DEFAULT 'admins'",
      system_key: "TEXT",
    }))
      add("spaces", name, sql);
    add(
      "space_members",
      "permissions",
      'TEXT NOT NULL DEFAULT \'{"publish":true,"edit":true,"delete":true,"settings":true,"members":true,"admins":false}\'',
    );
    add("media_assets", "scope", "TEXT NOT NULL DEFAULT 'chat'");
    add("media_assets", "sha256", "TEXT");
    add("ai_personas", "customization_enabled", "INTEGER NOT NULL DEFAULT 1");
    add("ai_personas", "last_profile_at", "INTEGER NOT NULL DEFAULT 0");
    add("ai_personas", "last_plan_at", "INTEGER NOT NULL DEFAULT 0");
    add("ai_jobs", "expires_at", "INTEGER");
    add("token_usage", "pricing_snapshot", "TEXT");
    add("reports", "reason_code", "TEXT NOT NULL DEFAULT 'other'");
    add("reports", "comment", "TEXT NOT NULL DEFAULT ''");
    add("reports", "target_type", "TEXT NOT NULL DEFAULT 'user'");
    add("reports", "assigned_to", "TEXT");
    add(
      "reports",
      "evidence_message_id",
      "TEXT REFERENCES messages(id) ON DELETE SET NULL",
    );
    db.exec(`
      CREATE TABLE IF NOT EXISTS notify_inboxes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,hidden INTEGER NOT NULL DEFAULT 0,muted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notify_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,importance TEXT NOT NULL DEFAULT 'normal',object_type TEXT,object_id TEXT,decision_id TEXT,ticket_id TEXT,payload TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,delivered_at INTEGER,read_at INTEGER,UNIQUE(user_id,event_key));
      CREATE INDEX IF NOT EXISTS notify_user_time ON notify_events(user_id,created_at);
      CREATE TABLE IF NOT EXISTS moderation_decisions(id TEXT PRIMARY KEY,target_type TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL,reason_code TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,parent_id TEXT,active INTEGER NOT NULL DEFAULT 1,starts_at INTEGER NOT NULL,expires_at INTEGER,ended_at INTEGER,end_reason TEXT,public_reason TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS decisions_target ON moderation_decisions(target_type,target_id,active);
      CREATE UNIQUE INDEX IF NOT EXISTS decision_parent_target ON moderation_decisions(parent_id,target_id) WHERE parent_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS support_tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,decision_id TEXT,target_type TEXT,target_id TEXT,status TEXT NOT NULL DEFAULT 'queued',subject TEXT NOT NULL,body TEXT NOT NULL,assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,request_key TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,request_key));
      CREATE UNIQUE INDEX IF NOT EXISTS ticket_one_active ON support_tickets(user_id) WHERE status IN ('active','waiting_user','escalated');
      CREATE INDEX IF NOT EXISTS ticket_queue ON support_tickets(status,updated_at);
      CREATE TABLE IF NOT EXISTS ticket_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,author_type TEXT NOT NULL,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ticket_media(ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,message_id TEXT REFERENCES ticket_messages(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES media_assets(id),PRIMARY KEY(ticket_id,media_id));
      CREATE TABLE IF NOT EXISTS verification_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,style TEXT NOT NULL,derive_badge INTEGER NOT NULL DEFAULT 0,requires_country INTEGER NOT NULL DEFAULT 0,description TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS verification_history(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,action TEXT NOT NULL,status_type TEXT NOT NULL,category_id TEXT,country TEXT,reason TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ownership_transfers(id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,accepted_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_transfer ON ownership_transfers(space_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS profile_history(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,actor_type TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_visits(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,last_message_id TEXT,last_visited_at INTEGER NOT NULL,visits INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,space_id));
      CREATE TABLE IF NOT EXISTS ai_deliveries(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,source_id TEXT,payload TEXT NOT NULL,due_at INTEGER NOT NULL,typing_until INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS channel_comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,author_id TEXT REFERENCES users(id) ON DELETE SET NULL,body TEXT NOT NULL,group_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,mode TEXT NOT NULL,created_at INTEGER NOT NULL,deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS media_garbage(filename TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS model_evaluations(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,provider_id TEXT,model_id TEXT NOT NULL,results TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER);
      CREATE INDEX IF NOT EXISTS deadlines_spaces ON spaces(delete_at) WHERE delete_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS deadlines_users ON users(deletion_at) WHERE deletion_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS deadlines_decisions ON moderation_decisions(expires_at) WHERE active=1;
      CREATE INDEX IF NOT EXISTS comments_post ON channel_comments(post_id,created_at);
    `);
    const category = db.prepare(
      "INSERT OR IGNORE INTO verification_categories VALUES(?,?,?,?,?,?)",
    );
    category.run(
      "blogger",
      "Блогер",
      "standard",
      1,
      0,
      "Данный канал подтверждён администрацией Orbit",
    );
    category.run(
      "company",
      "Компания",
      "company",
      1,
      0,
      "Подтверждённый источник компании",
    );
    category.run(
      "media",
      "СМИ",
      "diamond",
      1,
      1,
      "Проверенные администрацией сведения об источнике и стране финансирования",
    );
    if (
      !db
        .prepare(
          "SELECT 1 FROM system_settings WHERE key='master_schema_ready'",
        )
        .get()
    ) {
      const active = db
        .prepare("SELECT * FROM model_configurations WHERE task='message'")
        .get() as any;
      if (active)
        for (const task of [
          "personality",
          "message",
          "memory",
          "moderation",
          "planning",
        ])
          db.prepare(
            "INSERT INTO model_configurations VALUES(?,?,?) ON CONFLICT(task) DO UPDATE SET provider_id=excluded.provider_id,model_id=excluded.model_id",
          ).run(task, active.provider_id, active.model_id);
      db.exec("UPDATE ai_personas SET model_id=NULL");
      db.exec(`UPDATE spaces SET verification_type='standard',verification_state='active',verification_category='blogger' WHERE verified=1;
        UPDATE users SET verified=0;
        UPDATE users SET derived_verified=EXISTS(SELECT 1 FROM spaces s WHERE s.owner_id=users.id AND s.kind='channel' AND s.verified=1 AND s.frozen=0) WHERE status='active';`);
      const timestamp = Date.now();
      for (const u of db
        .prepare("SELECT id FROM users WHERE status='restricted'")
        .all() as any[])
        db.prepare(
          "INSERT OR IGNORE INTO moderation_decisions(id,target_type,target_id,action,reason_code,reason,starts_at,public_reason) VALUES(?,'user',?,'restrict','other','Ранее применённое ограничение',?,'Ограничение отправки')",
        ).run("legacy:restrict:" + u.id, u.id, timestamp);

      const legacy = db.prepare(
        "INSERT OR IGNORE INTO moderation_decisions(id,target_type,target_id,action,reason_code,reason,starts_at,public_reason) VALUES(?,?,?,'freeze','other',?,?,?)",
      );
      for (const u of db
        .prepare("SELECT id FROM users WHERE status='banned'")
        .all() as any[]) {
        const old = db
          .prepare(
            "SELECT reason FROM moderation_actions WHERE target_id=? AND action='ban' ORDER BY created_at DESC LIMIT 1",
          )
          .get(u.id) as any;
        const reason = old?.reason || "Ранее применённая блокировка";
        legacy.run(
          "legacy:user:" + u.id,
          "user",
          u.id,
          reason,
          timestamp,
          "Аккаунт заморожен",
        );
      }
      for (const s of db
        .prepare("SELECT id FROM spaces WHERE frozen=1")
        .all() as any[])
        legacy.run(
          "legacy:space:" + s.id,
          "space",
          s.id,
          "Ранее приостановленная работа сообщества",
          timestamp,
          "Ранее приостановленная работа сообщества",
        );
      db.prepare(
        "INSERT INTO system_settings VALUES('master_schema_ready','true')",
      ).run();
    }
    db.pragma("user_version=3");
  }).immediate();
}
