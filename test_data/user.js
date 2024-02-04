db.createUser(
    {
        user: "blert",
        pwd: "blert",
        roles:[
            {
                role: "readWrite",
                db:   "blert"
            }
        ]
    }
);