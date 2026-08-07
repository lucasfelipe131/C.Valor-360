-- Estrutura inicial PostgreSQL para VALOR 360
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  role VARCHAR(30) NOT NULL,
  unit_name VARCHAR(120),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY,
  consultant_id UUID REFERENCES users(id),
  name VARCHAR(160) NOT NULL,
  municipality VARCHAR(120),
  total_area_ha NUMERIC(12,2),
  cultures TEXT,
  preferred_channel TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE client_profiles (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  primary_profile VARCHAR(40),
  secondary_profile VARCHAR(40),
  irt NUMERIC(5,2),
  nps INTEGER,
  answers JSONB,
  assessed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE technical_context (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  property_name VARCHAR(160),
  weeds TEXT,
  diseases TEXT,
  insects TEXT,
  soil_summary TEXT,
  producer_goal TEXT,
  competitors TEXT,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE visits (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  consultant_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMP,
  objective TEXT,
  notes TEXT,
  next_commitment TEXT,
  next_action_at TIMESTAMP,
  status VARCHAR(30)
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  title VARCHAR(180),
  category VARCHAR(100),
  estimated_value NUMERIC(14,2),
  stage VARCHAR(30),
  probability INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE val_recommendations (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  visit_id UUID REFERENCES visits(id),
  context JSONB,
  recommendation JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
