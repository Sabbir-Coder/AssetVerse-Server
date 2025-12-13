require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(`${process.env.STRIPE_SECRET_KEY}`);
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
      "https://assets-verse.netlify.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("AssetVerseDB");
    const assetCollection = db.collection("assets");
    const userCollection = db.collection("users");
    const assetRequestCollection = db.collection("assetRequests");
    const assignedAssetCollection = db.collection("assignedAssets");
    const packagesCollection = db.collection("packages");

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
    // Delete an asset from ALL collections
    app.delete("/assets/:id", async (req, res) => {
      const id = req.params.id;

      const session = client.startSession();

      try {
        await session.withTransaction(async () => {
          // Delete from assets collection
          await assetCollection.deleteOne(
            { _id: new ObjectId(id) },
            { session }
          );

          // Delete all asset requests for this asset
          await assetRequestCollection.deleteMany(
            { assetId: id }, // assetId is stored as string in assetRequests
            { session }
          );

          // Delete assignedAssets containing this asset
          await assignedAssetCollection.deleteMany(
            { assetId: id }, // stored as string
            { session }
          );
        });

        res.send({ message: "Asset deleted from all collections" });
      } catch (err) {
        console.error("Error deleting asset:", err);
        res.status(500).send({ message: "Failed to delete asset", error: err });
      } finally {
        await session.endSession();
      }
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
        await assignedAssetCollection.insertOne({
          assetId: request.assetId,
          assetName: request.productName,
          assetType: request.productType,
          employeeEmail: request.requesterEmail,
          photoURL: asset.photoURL || asset.image,
          employeeName: request.requesterName,
          hrEmail: request.HrEmail,
          companyName: request.companyName,
          assignedDate: new Date().toLocaleString(),
          returnDate: null,
          status: "Assigned",
        });

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

        // Find all requests (Approved or Rejected) for this employee
        const requests = await assetRequestCollection
          .find({
            requesterEmail: email,
            requestStatus: { $in: ["Approved", "Rejected"] },
          })
          .toArray();

        if (!requests.length) {
          return res.send([]);
        }

        // Map each request to include full asset details
        const fullAssets = await Promise.all(
          requests.map(async (reqItem) => {
            const asset = await assetCollection.findOne({
              _id: new ObjectId(reqItem.assetId),
            });

            return {
              assetId: reqItem.assetId,
              productName: reqItem.productName,
              productType: reqItem.productType,
              requestDate: reqItem.requestDate,
              approvalDate: reqItem.approvalDate || null,
              status: reqItem.requestStatus, // Approved or Rejected
              assetImage: asset?.photoURL || asset?.image,
              companyName: asset?.companyName,
              description: asset?.description,
              returnable: asset?.returnable,
              quantity: asset?.quantity,
            };
          })
        );

        res.send(fullAssets);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get all assets assigned by a specific HR
    app.get("/assigned-assets", verifyJWT, async (req, res) => {
      try {
        const hrEmail = req.query.hrEmail; // frontend should send HR's email

        if (!hrEmail) {
          return res.status(400).send({ message: "HR email is required" });
        }

        // Fetch assigned assets where hrEmail matches
        const assignedAssets = await assignedAssetCollection
          .find({ hrEmail })
          .toArray();

        res.send(assignedAssets);
      } catch (err) {
        console.error("Error fetching assigned assets:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get list of companies
    app.get("/companies", async (req, res) => {
      try {
        const companies = await userCollection.distinct("companyName");
        res.send(companies);
      } catch (err) {
        console.error("Error fetching companies:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get employees of a selected company
    app.get("/company/:companyName/employees", async (req, res) => {
      try {
        const companyName = req.params.companyName;

        const employees = await userCollection
          .find(
            { companyName },
            {
              projection: {
                password: 0,
                assets: 0,
              },
            }
          )
          .toArray();

        res.send(employees);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get upcoming birthdays for the current month
    app.get("/company/:companyName/birthdays", async (req, res) => {
      try {
        const companyName = req.params.companyName;
        const currentMonth = new Date().getMonth() + 1;

        const birthdays = await userCollection
          .find(
            {
              companyName,
              dateOfBirth: { $exists: true },
            },
            {
              projection: {
                name: 1,
                email: 1,
                photoURL: 1,
                position: 1,
                dateOfBirth: 1,
              },
            }
          )
          .toArray();

        const upcoming = birthdays.filter((emp) => {
          const month = new Date(emp.dateOfBirth).getMonth() + 1;
          return month === currentMonth;
        });

        res.send(upcoming);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get total assets assigned to each employee for a specific HR
    app.get("/hr/employee-assets", verifyJWT, async (req, res) => {
      try {
        const hrEmail = req.query.hrEmail;
        if (!hrEmail)
          return res.status(400).send({ message: "HR email is required" });

        // Fetch all assigned assets for this HR
        const assignedAssets = await assignedAssetCollection
          .find({ hrEmail })
          .toArray();

        // Aggregate by employee
        const employeeMap = {};

        assignedAssets.forEach((asset) => {
          if (!employeeMap[asset.employeeEmail]) {
            employeeMap[asset.employeeEmail] = {
              employeeName: asset.employeeName,
              employeeEmail: asset.employeeEmail,
              photoURL: asset.photoURL,
              assignedDate: asset.assignedDate, // ✔ FIXED HERE
              assets: [],
            };
          }

          employeeMap[asset.employeeEmail].assets.push(asset);
        });

        // Convert map to array
        const employeesWithAssets = Object.values(employeeMap).map((emp) => ({
          ...emp,
          totalAssets: emp.assets.length,
        }));

        res.send(employeesWithAssets);
      } catch (err) {
        console.error("Error fetching employee assets:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update/Put Asset
    app.put("/assets/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedAsset = req.body;

        const session = client.startSession();

        await session.withTransaction(async () => {
          // 1. Update asset in main collection
          await assetCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedAsset },
            { session }
          );

          // 2. Sync fields in assignedAssets
          await assignedAssetCollection.updateMany(
            { assetId: id },
            {
              $set: {
                assetName: updatedAsset.productName,
                assetType: updatedAsset.productType,
                photoURL: updatedAsset.photoURL || updatedAsset.image,
              },
            },
            { session }
          );

          // 3. Sync fields in assetRequests
          await assetRequestCollection.updateMany(
            { assetId: id },
            {
              $set: {
                productName: updatedAsset.productName,
                productType: updatedAsset.productType,
              },
            },
            { session }
          );
        });

        res.send({ message: "Asset updated in all collections" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update the asset", error });
      }
    });

    // Get single asset by ID
    app.get("/assets/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!id)
          return res.status(400).send({ message: "Asset ID is required" });

        const asset = await assetCollection.findOne({ _id: new ObjectId(id) });

        if (!asset) return res.status(404).send({ message: "Asset not found" });

        res.send(asset);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = Number(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {       
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.name,
              },
            },
            quantity: 1,
          },
        ],

        mode: "payment",
        metadata: {
          packageId: paymentInfo.packageId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({url: session.url})
      
    });

    // get packages info
    app.get("/packages", async (req, res) => {
      const packages = await packagesCollection.find().toArray();
      res.send(packages);
    });
    app.get("/packages/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await packagesCollection.findOne(query);
      res.send(result);
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
