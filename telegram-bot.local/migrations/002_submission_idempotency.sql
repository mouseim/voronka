CREATE UNIQUE INDEX IF NOT EXISTS contacts_session_once
  ON contacts(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS applications_session_once
  ON applications(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS consents_session_node_once
  ON consents(session_id, node_id);
