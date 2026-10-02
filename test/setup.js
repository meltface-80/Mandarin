"use strict";
/*
 * Loaded before every test file (package.json's test script): the album
 * identification scan stays off unless a test turns it on, so the suite never
 * asks the real MusicBrainz about the fixture library.
 */
if (!process.env.IDENTIFY) process.env.IDENTIFY = "0";
// Nor Apple's iTunes: a closed port on loopback unless a test brings a fake.
if (!process.env.ITUNES_URL) process.env.ITUNES_URL = "http://127.0.0.1:9";
