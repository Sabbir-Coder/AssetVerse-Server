require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("AssetVerseDB");
    const assetCollection = db.collection("assets");
    const userCollection = db.collection("users");
    const assetRequestCollection = db.collection("assetRequests");

    // save asset in db
    app.post("/assets", async (req, res) => {
      const asset = req.body;
      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    // get hr assets from db
    app.get("/assets", async (req, res) => {
      const email = req.query.email;
      const filter = email ? { "hr.email": email } : {};
      const result = await assetCollection.find(filter).toArray();
      res.send(result);
    });

    // get asset for the employee all assets
    app.get("/all-assets", async (req, res) => {
      const data = await assetCollection.find().toArray();
      res.send(data);
    });

    // Delete a asset
    app.delete("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const result = await assetCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // save user in db
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // get all users from db
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // get user role by email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user.role });
    });

    // get one user by email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    // assets requests
    app.post("/asset-requests", async (req, res) => {
      const assetRequest = req.body;
      const id = req.params.id;
      console.log(assetRequest);

      const result = await assetRequestCollection.insertOne(assetRequest);
      res.send(result);
    });

    // -----------------------------------
    // -----------------------------------
    // -----------------------------------

    // Get all asset requests for a specific HR (company)
    // Get all asset requests for a specific HR (company)
    app.get("/asset-requests", async (req, res) => {
      try {
        const hrEmail = req.query.HrEmail; // match frontend query
        if (!hrEmail)
          return res.status(400).send({ message: "HR Email is required" });

        const requests = await assetRequestCollection
          .find({ HrEmail: hrEmail })
          .toArray();

        res.send(requests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // Approve asset request
    app.patch("/asset-requests/:id/approve", async (req, res) => {
      try {
        const requestId = req.params.id;
        const request = await assetRequestCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ message: "Request not found" });
        if (request.requestStatus !== "Pending")
          return res.status(400).send({ message: "Request already processed" });

        // Deduct quantity from asset
        const asset = await assetCollection.findOne({
          _id: new ObjectId(request.assetId),
        });
        if (!asset) return res.status(404).send({ message: "Asset not found" });
        if (asset.quantity < 1)
          return res
            .status(400)
            .send({ message: "Insufficient asset quantity" });

        await assetCollection.updateOne(
          { _id: new ObjectId(request.assetId) },
          { $inc: { quantity: -1 } }
        );

        // Update request status to Approved
        await assetRequestCollection.updateOne(
          { _id: new ObjectId(requestId) },
          {
            $set: {
              requestStatus: "Approved",
              approvalDate: new Date(),
              processedBy: request.HrEmail,
            },
          }
        );

        // Add asset to employee's asset list
        await userCollection.updateOne(
          { email: request.requesterEmail },
          {
            $push: {
              assets: {
                assetId: request.assetId,
                productName: request.productName,
                productType: request.productType,
                dateAssigned: new Date(),
              },
            },
          }
        );

        res.send({ message: "Request approved successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // Reject asset request
    app.patch("/asset-requests/:id/reject", async (req, res) => {
      try {
        const requestId = req.params.id;
        const request = await assetRequestCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ message: "Request not found" });
        if (request.requestStatus !== "Pending")
          return res.status(400).send({ message: "Request already processed" });

        await assetRequestCollection.updateOne(
          { _id: new ObjectId(requestId) },
          {
            $set: {
              requestStatus: "Rejected",
              approvalDate: new Date(),
              processedBy: request.HrEmail,
            },
          }
        );

        res.send({ message: "Request rejected successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // Get assets for a specific employee
app.get("/users/:email/assets", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await userCollection.findOne({ email }, { projection: { assets: 1, _id: 0 } });

    if (!user) {
      return res.status(404).send({ message: "Employee not found" });
    }

    // If user has no assets, return empty array
    res.send(user.assets || []);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from AssetVerse Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
