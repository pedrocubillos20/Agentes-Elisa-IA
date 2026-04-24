// Test setup
process.env.JWT_SECRET = 'test-jwt-secret-de-al-menos-64-caracteres-para-testing-unitario';
process.env.REFRESH_SECRET = 'test-refresh-secret-64-chars-para-testing';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/bizonne_test';
process.env.NODE_ENV = 'test';
