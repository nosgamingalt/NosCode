require('dotenv').config();
const db = require('./database');

async function setupDatabase() {
    try {
        console.log('🔄 Initializing database...');
        console.log('📍 Connection:', process.env.DATABASE_URL ? 'Configured' : '❌ DATABASE_URL not set!');
        
        if (!process.env.DATABASE_URL) {
            console.error('\n❌ ERROR: DATABASE_URL environment variable is not set!');
            console.log('\n📝 Please create a .env file with:');
            console.log('DATABASE_URL=postgresql://username:password@host:port/database\n');
            process.exit(1);
        }
        
        await db.initDatabase();
        
        console.log('\n✅ Database setup complete!');
        console.log('\nDatabase tables created:');
        console.log('  ✓ projects');
        console.log('  ✓ files');
        console.log('  ✓ chat_history');
        console.log('\n🚀 You can now start the server with: node server.js');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Database setup failed:', error.message);
        console.error('\nFull error:', error);
        
        if (error.message.includes('ECONNREFUSED')) {
            console.log('\n💡 Tip: Make sure PostgreSQL is running and DATABASE_URL is correct');
        }
        
        process.exit(1);
    }
}

setupDatabase();
