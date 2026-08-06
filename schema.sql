-- C.Valor 360 — Modelo inicial PostgreSQL
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('consultor','gerente','admin')),
  unit_name VARCHAR(120),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY,
  consultant_id UUID REFERENCES users(id),
  name VARCHAR(160) NOT NULL,
  municipality VARCHAR(120),
  total_area_ha NUMERIC(12,2),
  phone VARCHAR(40),
  preferred_channel VARCHAR(40),
  status VARCHAR(30) DEFAULT 'ativo',
  last_contact_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE client_profiles (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  primary_profile VARCHAR(40),
  secondary_profile VARCHAR(40),
  interaction_preference VARCHAR(40),
  irt_score NUMERIC(5,2),
  nps_score INTEGER,
  price_sensitivity INTEGER,
  innovation_openness INTEGER,
  trust_score INTEGER,
  notes TEXT,
  assessed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE properties (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(160),
  municipality VARCHAR(120),
  area_ha NUMERIC(12,2),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7)
);

CREATE TABLE crop_seasons (
  id UUID PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  season VARCHAR(20),
  crop VARCHAR(60),
  area_ha NUMERIC(12,2),
  productivity_avg NUMERIC(10,2),
  productivity_target NUMERIC(10,2)
);

CREATE TABLE visits (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  consultant_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  objective TEXT,
  summary TEXT,
  next_commitment TEXT,
  next_action_at TIMESTAMP,
  status VARCHAR(30)
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  category VARCHAR(100),
  title VARCHAR(180),
  description TEXT,
  estimated_value NUMERIC(14,2),
  stage VARCHAR(30),
  probability INTEGER,
  urgency_score INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE value_cases (
  id UUID PRIMARY KEY,
  opportunity_id UUID REFERENCES opportunities(id),
  cost_per_ha NUMERIC(12,2),
  expected_gain_sc_ha NUMERIC(10,2),
  commodity_price NUMERIC(12,2),
  avoided_loss NUMERIC(14,2),
  expected_revenue NUMERIC(14,2),
  roi_percent NUMERIC(10,2),
  assumptions JSONB
);

CREATE TABLE val_recommendations (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  visit_id UUID REFERENCES visits(id),
  recommendation_type VARCHAR(50),
  input_context JSONB,
  generated_content JSONB,
  model_version VARCHAR(40),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_clients_consultant ON clients(consultant_id);
CREATE INDEX idx_visits_client_date ON visits(client_id, scheduled_at);
CREATE INDEX idx_opportunities_client_stage ON opportunities(client_id, stage);
