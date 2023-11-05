const express = require("express");
const admin = require("firebase-admin");
const uuid = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken")
const bodyParser = require("body-parser");
require("dotenv").config()

const app = express();
app.use(express.json());
app.use(bodyParser.json());

const serviceAccount = require(process.env.SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.BUCKET_NAME,
  });

const db = admin.firestore();

// Verify Token
const verifyToken = async (req, res, next) => {

  const token = req.header("Authorization")

  console.log(token)

  if (!token) {
    return res.status(401).json({ error: "Access denied. Token missing." });
  }

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.SECRET_KEY);
    req.username = decoded
    next();
  } catch (error) {
    console.log(error)
    res.status(401).json({ error: 'Access denied. Invalid token.' });
  }

}

// API endpoint for login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const userSnapshot = await db.collection("users").where("email", "==", email).limit(1).get();

    if (userSnapshot.empty) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }

    const user = userSnapshot.docs[0].data();

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.SECRET_KEY, { expiresIn: '1h' });

    res.status(200).json({ token: token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const revokedTokens = new Set();

// API endpoint for logout
app.post("/api/logout", (req, res) => {
  try {
    const token = req.query.token;

    if (!token) {
      return res.status(401).json({ error: "Access denied. Token missing." });
    }

    // Check if the token has already been revoked
    if (revokedTokens.has(token)) {
      return res.status(401).json({ error: "Access denied. Token has already been revoked." });
    }

    // Add the token to the blacklist (revoke the token)
    revokedTokens.add(token);

    // Respond with a success message
    res.status(200).json({ message: "Logout successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});


// API endpoint for creating the new user
app.post("/api/new-user", async (req, res) => {
  try {
    const {username, email, mobileNumber, password } = req.body;
    const existingUserSnapshot = await db.collection("users").where("email", "==", email).limit(1).get();
    
    if (!existingUserSnapshot.empty) {
      return res.status(409).json({error: "Email already exists. Please choose a different email."})
    }

    const userId = uuid.v4();

    const hashedPassword = await bcrypt.hash(password, 10);

    const registeredDate = new Date();

    const newUser = {
      username,
      email,
      mobileNumber,
      registeredDate,
      password: hashedPassword,
    }

    await db.collection("users").doc(userId).set(newUser);
    res.status(201).json({ userId })
    
  } catch (error) { 
    console.log(error)
  }
});

// API endpoint for getting all projects
app.get("/api/projects", verifyToken, async (req, res) => {
  try {
    const projectsSnapshot = await db.collection("projects").get();
    const projectsList = [];
    
    if (projectsSnapshot.empty) {
      return res.status(404).json({ message: "No projects found." });
    }

    projectsSnapshot.forEach((doc) => {
      projectsList.push({
        id: doc.id,
        title: doc.data().title,
        description: doc.data().description,
        technologies: doc.data().technologies,
        sourceCode: doc.data().sourceCode,
      })
    })

    res.status(200).json(projectsList);

  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Something went wrong." });
  }
})

// API end point for get users
app.get("/api/get-users", verifyToken, async (req, res) => {
  try {
    const usersSnapshot = await db.collection("users").get();
    const usersList = []

    if (usersSnapshot.empty) {
      return res.status(404).json({ message: "No users found." });
    }

    usersSnapshot.forEach((doc) => {
      usersList.push({
        id: doc.id,
        username: doc.data().username,
        email: doc.data().email,
        mobileNumber: doc.data().mobileNumber,
      })
    })

    res.status(200).json(usersList);
    
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: "Something went wrong." });
  }
})

// API endpoint for creating the new project
app.post("/api/create-new-project", verifyToken, async (req, res) => {
  try {
    const { title, description, technologies, sourceCode } = req.body;

    // Generate a unique project ID
    const projectID = uuid.v4();

    // Construct the project data with the image URLs
    const projectData = {
      title,
      description,
      technologies,
      sourceCode,
    };

    console.log(projectData)

    await db.collection("projects").doc(projectID).set(projectData);

    res.status(201).json({ projectID });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// API endpoint for updating the specific project
app.patch("/api/projects/:projectID", verifyToken, async (req, res) => {
  try {
    const projectID = req.params.projectID;

    console.log(projectID)

    const {
      title, 
      description, 
      technologies, 
      sourceCode
    } = req.body;

    console.log(title)
    console.log(description)
    console.log(technologies)
    console.log(sourceCode)

    const projectIDRef = db.collection("projects").doc(projectID);
    const projectIDDoc = await projectIDRef.get();

    if (!projectIDDoc.exists) {
      return res.status(404).json({ error: "Project not found." });
    }

    const updateProject = {
      title: title || projectIDDoc.data().title,
      description: description || projectIDDoc.data().description,
      technologies : technologies  ? technologies   : projectIDDoc.data().technologies,
      sourceCode: sourceCode || projectIDDoc.data().sourceCode,
    }

    await projectIDRef.update(updateProject);
    res.status(200).json({ message: "Project updated successfully." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// API endpoint for deleting specific project
app.delete("/api/projects/:projectID", verifyToken, async (req, res) => {
  try {
    const projectID = req.params.projectID;

    const projectsDoc = db.collection("projects").doc(projectID);

    const projectsSnapshot = await projectsDoc.get();

    if (!projectsSnapshot.exists) {
      return res.status(404).json({ error: "Project not found." });
    }

    await projectsDoc.delete();

    res.status(200).json({ message: "Project deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port http://localhost:${PORT}/`);
});
