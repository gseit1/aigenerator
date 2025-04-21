const express = require('express');
const mysql = require('mysql2');
const dotenv = require('dotenv');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables
dotenv.config();

// Create an Express app
const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());
// Set up MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('error connecting to the database:', err);
  } else {
    console.log('connected to MySQL database');
  }
});

// OpenAI API key

// JWT Secret key
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// POST route to signup
app.post('/api/signup', async (req, res) => {
    const { username, email, password } = req.body;
  
    try {
      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Insert user into the database
      const query = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
      db.query(query, [username, email, hashedPassword], (err, result) => {
        if (err) {
          console.error('Error signing up:', err);
          return res.status(500).json({ message: 'Signup failed' }); // Ensure 'message' is returned
        }
        res.status(201).json({ message: 'User created successfully' }); // Ensure 'message' is returned
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ message: 'Internal server error' }); // Ensure 'message' is returned
    }
  });

// POST route to login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // Get user from the database
  const query = 'SELECT * FROM users WHERE email = ?';
  db.query(query, [email], async (err, results) => {
    if (err) {
      console.error('Error logging in:', err);
      return res.status(500).json({ error: 'Login failed' });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = results[0];

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });

    res.json({ token });
  });
});

// Middleware to authenticate the user
const authenticate = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
  
    try {
      const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET); // Extract the token after "Bearer"
      req.userId = decoded.userId;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

// POST route to generate bio using OpenAI (authenticated)
// POST route to generate bio using OpenAI (authenticated)
app.post('/api/generate', authenticate, async (req, res) => {
    const { prompt, captionType, isShared } = req.body;  // Add isShared to the request body
  
    if (!captionType) {
      return res.status(400).json({ error: 'Caption type is required' });
    }
  
    try {
      // Modify the prompt based on whether the user has shared the page
      let modifiedPrompt = `Generate a ${captionType} caption that is short and on point: ${prompt}`;
      
      if (isShared) {
        // If the user has shared the page, provide a better or more detailed response
        modifiedPrompt = `Generate a detailed and high-quality ${captionType} caption: ${prompt}`;
      }
  
      // Call the external AI API with the modified prompt
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: "mistralai/mistral-7b-instruct", // FREE model
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: modifiedPrompt },
          ],
          max_tokens: 150, // Increase the token limit for better answers
        },
        {
          headers: {
            Authorization: `Bearer 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`,  // Make sure to replace this with a secure API key
          },
        }
      );
  
      // Retrieve the generated response text
      const generatedText = response.data.choices[0].message.content.trim();
  
      // Save the result to the database
      const query = 'INSERT INTO bios (user_id, prompt, result) VALUES (?, ?, ?)';
      db.query(query, [req.userId, prompt, generatedText], (err) => {
        if (err) {
          console.error('Error saving to database:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        // Return the generated result after saving it to the database
        return res.json({ result: generatedText });
      });
    } catch (error) {
      console.error("Error calling OpenAI API:", error.response?.data || error.message);
      res.status(500).json({
        error: "AI generation error",
        details: error.response?.data || error.message,
      });
    }
  });
  app.get('/api/history', authenticate, (req, res) => {
  const query = 'SELECT * FROM bios WHERE user_id = ? ORDER BY created_at DESC';
  db.query(query, [req.userId], (err, results) => {
    if (err) {
      console.error('Error fetching history:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    return res.json(results);
  });
});

app.delete('/api/history/:id', authenticate, (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM bios WHERE id = ? AND user_id = ?';
    db.query(query, [id, req.userId], (err, result) => {
      if (err) {
        console.error('Error deleting bio:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(200).json({ message: 'Bio deleted successfully' });
    });
  });

  app.put('/api/history/:id', authenticate, (req, res) => {
    const { id } = req.params;
    const { prompt, result } = req.body;
    const query = 'UPDATE bios SET prompt = ?, result = ? WHERE id = ? AND user_id = ?';
    db.query(query, [prompt, result, id, req.userId], (err, result) => {
      if (err) {
        console.error('Error updating bio:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(200).json({ message: 'Bio updated successfully' });
    });
  });
  
  // GET route to fetch user details and bios (authenticated)
app.get('/api/profile', authenticate, (req, res) => {
    const userQuery = 'SELECT username, email FROM users WHERE id = ?';
    const biosQuery = 'SELECT * FROM bios WHERE user_id = ? ORDER BY created_at DESC';
  
    // Fetch user details
    db.query(userQuery, [req.userId], (err, userResults) => {
      if (err) {
        console.error('Error fetching user details:', err);
        return res.status(500).json({ error: 'Database error' });
      }
  
      if (userResults.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      const user = userResults[0];
  
      // Fetch user's bios
      db.query(biosQuery, [req.userId], (err, biosResults) => {
        if (err) {
          console.error('Error fetching bios:', err);
          return res.status(500).json({ error: 'Database error' });
        }
  
        // Combine user details and bios
        return res.json({
          user,
          bios: biosResults,
        });
      });
    });
  });

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
