const { Pool } = require('pg');
const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
});
