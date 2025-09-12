
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, ImageRun } = require("docx");
const JSZip = require("jszip");
const sharp = require("sharp");
const { nanoid } = require("nanoid");

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${nanoid()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|webp|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  }
});

// Helper function to clean up files
const cleanupFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
};

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/photo-converter", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Upload endpoint
app.post("/upload", upload.array("photos", 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const fileInfo = req.files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      path: file.path
    }));

    res.json({
      success: true,
      message: "Files uploaded successfully",
      files: fileInfo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert to ZIP
app.post("/convert/zip", upload.array("photos", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const zip = new JSZip();
    const filePaths = [];

    // Add files to zip
    req.files.forEach(file => {
      const fileData = fs.readFileSync(file.path);
      zip.file(file.originalname, fileData);
      filePaths.push(file.path);
    });

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipFilename = `converted-photos-${nanoid()}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
    res.send(zipBuffer);

    // Cleanup
    cleanupFiles(filePaths);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert to PDF
app.post("/convert/pdf", upload.array("photos", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const doc = new PDFDocument({ autoFirstPage: false });
    const filePaths = [];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="converted-photos-${nanoid()}.pdf"`);
    
    doc.pipe(res);

    for (const file of req.files) {
      try {
        // Add new page for each image
        doc.addPage();
        
        // Get image dimensions
        const imageInfo = await sharp(file.path).metadata();
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        
        // Calculate scaling to fit image on page
        const scaleX = pageWidth / imageInfo.width;
        const scaleY = pageHeight / imageInfo.height;
        const scale = Math.min(scaleX, scaleY) * 0.8; // 80% of page size
        
        const scaledWidth = imageInfo.width * scale;
        const scaledHeight = imageInfo.height * scale;
        
        // Center image on page
        const x = (pageWidth - scaledWidth) / 2;
        const y = (pageHeight - scaledHeight) / 2;
        
        doc.image(file.path, x, y, { width: scaledWidth, height: scaledHeight });
      } catch (imageError) {
        console.error(`Error processing image:`, imageError);
      }
      
      filePaths.push(file.path);
    }

    doc.end();

    // Cleanup after response is sent
    res.on("finish", () => {
      cleanupFiles(filePaths);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert to Word Document
app.post("/convert/word", upload.array("photos", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const filePaths = [];
    const paragraphs = [];

    for (const file of req.files) {
      try {
        // Convert image to base64 for embedding
        const imageBuffer = fs.readFileSync(file.path);
        
        paragraphs.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: {
                  width: 400,
                  height: 300,
                },
              }),
            ],
          })
        );
      } catch (imageError) {
        console.error(`Error processing image:`, imageError);
      }
      
      filePaths.push(file.path);
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="converted-photos-${nanoid()}.docx"`);
    res.send(buffer);

    // Cleanup
    cleanupFiles(filePaths);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert to GIF (animated)
app.post("/convert/gif", upload.array("photos", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const filePaths = req.files.map(file => file.path);
    const gifFilename = `converted-photos-${nanoid()}.gif`;

    // Use sharp to create animated GIF
    let gifBuffer;
    if (req.files.length === 1) {
      gifBuffer = await sharp(filePaths[0])
        .gif({ delay: 500, loop: 0 })
        .toBuffer();
    } else {
      // For multiple images, create animated GIF
      gifBuffer = await sharp(filePaths[0], { animated: true })
        .gif({ delay: 500, loop: 0 })
        .toBuffer();
    }

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Disposition", `attachment; filename="${gifFilename}"`);
    res.send(gifBuffer);

    // Cleanup
    cleanupFiles(filePaths);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert image to different formats
app.post("/convert/image/:format", upload.array("photos", 10), async (req, res) => {
  try {
    const { format } = req.params;
    const allowedFormats = ["jpeg", "png", "webp", "gif", "bmp", "tiff"];
    
    if (!allowedFormats.includes(format.toLowerCase())) {
      return res.status(400).json({ error: "Unsupported format" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const filePaths = req.files.map(file => file.path);
    const convertedFiles = [];

    // Convert each image
    for (const file of req.files) {
      try {
        const outputFilename = `${path.parse(file.originalname).name}.${format}`;
        const outputPath = path.join(uploadsDir, `${nanoid()}-${outputFilename}`);
        
        await sharp(file.path)
          .toFormat(format)
          .toFile(outputPath);
        
        convertedFiles.push({
          originalName: file.originalname,
          convertedName: outputFilename,
          path: outputPath
        });
      } catch (conversionError) {
        console.error(`Error converting ${file.originalname}:`, conversionError);
      }
    }

    if (convertedFiles.length === 0) {
      return res.status(500).json({ error: "No files were successfully converted" });
    }

    // If single file, send directly
    if (convertedFiles.length === 1) {
      const file = convertedFiles[0];
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("Content-Disposition", `attachment; filename="${file.convertedName}"`);
      res.sendFile(file.path);
      
      // Cleanup
      cleanupFiles([...filePaths, file.path]);
    } else {
      // Multiple files - create ZIP
      const zip = new JSZip();
      
      convertedFiles.forEach(file => {
        const fileData = fs.readFileSync(file.path);
        zip.file(file.convertedName, fileData);
      });

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const zipFilename = `converted-images-${format}-${nanoid()}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
      res.send(zipBuffer);

      // Cleanup
      const allPaths = [...filePaths, ...convertedFiles.map(f => f.path)];
      cleanupFiles(allPaths);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 50MB." });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Too many files. Maximum is 10 files." });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Photo Converter Server running at http://localhost:${PORT}`);
  console.log(`Network access: http://YOUR_IP_ADDRESS:${PORT}`);
  console.log("Supported conversions:");
  console.log("- ZIP: Multiple photos in a compressed archive");
  console.log("- PDF: Photos arranged in a PDF document");
  console.log("- Word: Photos embedded in a Word document");
  console.log("- GIF: Animated GIF from multiple photos");
  console.log("- Image formats: JPEG, PNG, WebP, GIF, BMP, TIFF");
});
