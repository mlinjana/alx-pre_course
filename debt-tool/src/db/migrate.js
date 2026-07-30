#!/usr/bin/env node
import { getDb, closeDb } from './index.js';
import { config } from '../config.js';

getDb();
console.log(`Schema applied to ${config.databaseFile}`);
closeDb();
