import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/grocery_app';
const sql = postgres(DATABASE_URL);

export default sql;