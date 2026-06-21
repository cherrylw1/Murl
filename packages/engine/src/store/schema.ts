export const CREATE_RUNS_TABLE = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    start_url TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
`;

export const CREATE_STEPS_TABLE = `
  CREATE TABLE IF NOT EXISTS steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    thought TEXT,
    action_json TEXT NOT NULL,
    page_url TEXT,
    page_title TEXT,
    page_state_json TEXT,
    note TEXT,
    screenshot_path TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    created_at INTEGER NOT NULL
  );
`;
