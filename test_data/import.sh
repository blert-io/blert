#!/bin/bash
mongoimport --collection raids --file /docker-entrypoint-initdb.d/raids.json --jsonArray -u blert -p blert --authenticationDatabase=admin
mongoimport --collection roomevents --file /docker-entrypoint-initdb.d/room-events.json --jsonArray -u blert -p blert --authenticationDatabase=admin
