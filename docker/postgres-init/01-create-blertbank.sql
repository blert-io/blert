CREATE USER blertbank WITH PASSWORD 'blertbank';
CREATE DATABASE blertbank OWNER blertbank;
CREATE DATABASE blertbank_test OWNER blertbank;
GRANT ALL PRIVILEGES ON DATABASE blertbank TO blertbank;
GRANT ALL PRIVILEGES ON DATABASE blertbank_test TO blertbank;
