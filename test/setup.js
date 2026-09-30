"use strict";
/*
 * Loaded before every test file (package.json's test script): the album
 * identification scan stays off unless a test turns it on, so the suite never
 * asks the real MusicBrainz about the fixture library.
 */
if (!process.env.IDENTIFY) process.env.IDENTIFY = "0";
