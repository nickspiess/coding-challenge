# EmpowerFresh Grocery ETL

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL** installed and running locally

## Setup

```bash
# 1. Create the database
createdb grocery_app

# 2. Install dependencies
cd coding-challenge/senior
npm install

# 3. Run migrations (creates all tables, indexes, constraints)
npm run migrate

# 4. Start the dev server
npm run dev
```

App runs at http://localhost:5173

## Database Schema

### Tables

```
customers
  id            SERIAL PRIMARY KEY
  name          TEXT NOT NULL UNIQUE
  created_at    TIMESTAMPTZ

stores
  id            SERIAL PRIMARY KEY
  customer_id   INTEGER NOT NULL  → customers(id)
  store_code    TEXT NOT NULL
  name          TEXT
  UNIQUE(customer_id, store_code)

products
  id            SERIAL PRIMARY KEY
  customer_id   INTEGER NOT NULL  → customers(id)
  upc_plu       TEXT NOT NULL
  description   TEXT
  department    TEXT
  category      TEXT
  unit_size     TEXT
  pack_size     TEXT
  link_code     TEXT
  UNIQUE(customer_id, upc_plu)

prices
  id            SERIAL PRIMARY KEY
  store_id      INTEGER NOT NULL  → stores(id)
  upc_plu       TEXT NOT NULL
  price         NUMERIC NOT NULL
  price_type    TEXT
  price_priority TEXT
  price_multiple TEXT
  unit_multiple NUMERIC
  start_date    DATE
  end_date      DATE

sales
  id            SERIAL PRIMARY KEY
  store_id      INTEGER NOT NULL  → stores(id)
  upc_plu       TEXT NOT NULL
  description   TEXT
  unit_size     TEXT
  sale_time     TIMESTAMPTZ
  price_type    TEXT
  unit_price    NUMERIC          (nullable — missing data stays NULL)
  units_sold    NUMERIC          (nullable)
  total_sale    NUMERIC          (nullable)

import_log
  id            SERIAL PRIMARY KEY
  customer_id   INTEGER          → customers(id)
  file_type     TEXT NOT NULL     (product / price / sale)
  file_hash     TEXT              (SHA-256 for duplicate detection)
  original_filename TEXT
  status        TEXT NOT NULL     (pending / processing / completed / failed / duplicate)
  rows_total    INTEGER
  rows_inserted INTEGER
  rows_skipped  INTEGER
  rows_flagged  INTEGER
  rows_held     INTEGER
  error_message TEXT
  completed_at  TIMESTAMPTZ

etl_flags
  id            SERIAL PRIMARY KEY
  job_id        INTEGER NOT NULL  → import_log(id) ON DELETE CASCADE
  row_number    INTEGER
  column_name   TEXT
  original_value TEXT
  flag_type     TEXT NOT NULL     (missing / invalid / unknown_format / duplicate / skipped_row / parse_error)
  severity      TEXT NOT NULL     (info / warning / error)
  message       TEXT NOT NULL
  record_id     INTEGER          (links to the inserted record or review queue item)
  record_table  TEXT             (products / prices / sales / etl_review_queue)

etl_review_queue
  id            SERIAL PRIMARY KEY
  job_id        INTEGER NOT NULL  → import_log(id) ON DELETE CASCADE
  row_number    INTEGER
  file_type     TEXT NOT NULL
  row_data      JSONB NOT NULL    (original CSV row as JSON)
  flag_type     TEXT NOT NULL
  flag_message  TEXT NOT NULL
  status        TEXT NOT NULL     (pending / resolved / discarded)
  resolved_data JSONB
  resolved_at   TIMESTAMPTZ
```

### Foreign Keys

- `stores.customer_id` → `customers.id`
- `products.customer_id` → `customers.id`
- `prices.store_id` → `stores.id`
- `sales.store_id` → `stores.id`
- `import_log.customer_id` → `customers.id`
- `etl_flags.job_id` → `import_log.id` (CASCADE DELETE)
- `etl_review_queue.job_id` → `import_log.id` (CASCADE DELETE)