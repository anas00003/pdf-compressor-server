const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Set Ghostscript path (confirmed working path)
const gsBinary = process.platform === 'win32'
  ? path.join('C:', 'Program Files (x86)', 'gs', 'gs10.05.1', 'bin', 'gswin32c.exe')
  : 'gs';

// Ensure uploads folder exists
const uploadsDir = path.resolve('uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for PDF uploads
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.static('public'));

// Compress PDF using Ghostscript (using spawn instead of exec)
function compressPdf(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      inputPath
    ];

    const gs = spawn(gsBinary, args);

    let errorOutput = '';
    gs.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    gs.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ghostscript failed with code ${code}: ${errorOutput}`));
      }
    });

    gs.on('error', (err) => {
      reject(new Error(`Ghostscript execution error: ${err.message}`));
    });
  });
}

// Delete temp files
function cleanupFiles(...paths) {
  paths.forEach(filePath => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Error cleaning up file:', filePath, err);
    }
  });
}

// POST route to handle uploaded file
app.post('/compress', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const originalPath = req.file.path;
  const renamedPath = `${originalPath}.pdf`;
  const outputPath = path.join(uploadsDir, `compressed_${req.file.filename}.pdf`);
  
  try {
    // Rename file to ensure .pdf extension
    await fs.promises.rename(originalPath, renamedPath);

    // Compress the PDF
    await compressPdf(renamedPath, outputPath);

    // Verify output file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Compression failed - no output file created');
    }

    // Send the compressed file
    res.download(outputPath, `compressed_${req.file.originalname}`, (err) => {
      cleanupFiles(renamedPath, outputPath);
      if (err) {
        console.error('Download error:', err);
      }
    });
  } catch (err) {
    console.error('Error processing PDF:', err);
    cleanupFiles(originalPath, renamedPath, outputPath);
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('🧾 PDF compression tool is ready!');
  console.log(`📌 Using Ghostscript at: ${gsBinary}`);
});