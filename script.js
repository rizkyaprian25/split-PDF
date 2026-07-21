const { PDFDocument } = PDFLib;

// Wait for PDF.js to load
async function waitForPdfJs() {
  let attempts = 0;
  while (typeof pdfjsLib === 'undefined' && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', waitForPdfJs);
waitForPdfJs(); // Also try immediately

// Utility: Render PDF page to image with quality control
async function renderPageToImage(pdf, pageNum, scale = 1, quality = 0.75) {
  try {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const context = canvas.getContext('2d', { alpha: false });
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    // Convert to JPEG
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        'image/jpeg',
        quality
      );
    });
  } catch (error) {
    console.error(`Error rendering page ${pageNum}:`, error);
    throw error;
  }
}

// Fallback with explicit PDF bytes parameter
async function compressPdfSimpleInternal(level, pdfBytesData) {
  const srcDoc = await PDFDocument.load(pdfBytesData);
  const newDoc = await PDFDocument.create();
  
  // Copy all pages
  const pages = await newDoc.copyPages(srcDoc, srcDoc.getPageIndices());
  pages.forEach(page => newDoc.addPage(page));
  
  // Remove metadata to reduce size slightly
  if (level >= 3) {
    newDoc.setTitle('');
    newDoc.setAuthor('');
    newDoc.setSubject('');
    newDoc.setKeywords([]);
  }
  
  return await newDoc.save();
}

// Canvas compression with explicit PDF bytes parameter
async function compressWithCanvasInternal(level, pdf, pdfBytesData) {
  const settings = {
    1: { scale: 1.0, quality: 0.95 },
    2: { scale: 0.85, quality: 0.85 },
    3: { scale: 0.7, quality: 0.75 },
    4: { scale: 0.55, quality: 0.65 },
    5: { scale: 0.4, quality: 0.50 }
  };
  
  const { scale, quality } = settings[level];
  const numPages = pdf.numPages;
  const newDoc = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    updateCompressStatus(`Memproses halaman ${pageNum}/${numPages}...`);
    
    try {
      const imageBlob = await renderPageToImage(pdf, pageNum, scale, quality);
      const imageArrayBuffer = await imageBlob.arrayBuffer();
      const imageBytes = new Uint8Array(imageArrayBuffer);
      
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      const image = await newDoc.embedJpg(imageBytes);
      
      const pdfPage = newDoc.addPage([viewport.width, viewport.height]);
      pdfPage.drawImage(image, 0, 0, viewport.width, viewport.height);
      
    } catch (pageError) {
      console.warn(`Warning on page ${pageNum}:`, pageError);
      continue;
    }
  }

  if (newDoc.getPageCount() === 0) {
    throw new Error('Tidak ada halaman yang berhasil diproses.');
  }

  return await newDoc.save();
}

// SPLIT TAB VARIABLES
let pdfBytes = null;
let loadedPdfDoc = null;
let totalPages = 0;
let currentObjectUrl = null;

// COMPRESS TAB VARIABLES
let compressPdfBytes = null;
let compressCurrentObjectUrl = null;
let originalFileSize = 0;
let isCompressing = false; // Prevent concurrent compressions

// TAB SWITCHING
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// SPLIT TAB ELEMENTS
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const dropText = document.getElementById('dropText');
const previewContainer = document.getElementById('previewContainer');
const startPage = document.getElementById('startPage');
const endPage = document.getElementById('endPage');
const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const downloadWrap = document.getElementById('downloadWrap');
const downloadLink = document.getElementById('downloadLink');

// COMPRESS TAB ELEMENTS
const compressDropZone = document.getElementById('compressDropZone');
const compressFileInput = document.getElementById('compressFileInput');
const compressFileName = document.getElementById('compressFileName');
const compressFileMeta = document.getElementById('compressFileMeta');
const compressDropText = document.getElementById('compressDropText');
const compressionLevel = document.getElementById('compressionLevel');
const levelDisplay = document.getElementById('levelDisplay');
const compressBtn = document.getElementById('compressBtn');
const compressStatusEl = document.getElementById('compressStatus');
const compressDownloadWrap = document.getElementById('compressDownloadWrap');
const compressDownloadLink = document.getElementById('compressDownloadLink');

const levelLabels = ['Minimal', 'Rendah', 'Sedang', 'Tinggi', 'Maksimal'];

compressionLevel.addEventListener('change', (e) => {
  levelDisplay.textContent = levelLabels[e.target.value - 1];
});

function updateStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : 'status';
}

function updateCompressStatus(message, type = '') {
  compressStatusEl.textContent = message;
  compressStatusEl.className = type ? `status ${type}` : 'status';
}

function clearDownloadLink() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  downloadWrap.style.display = 'none';
  downloadLink.href = '';
}

function clearCompressDownloadLink() {
  if (compressCurrentObjectUrl) {
    URL.revokeObjectURL(compressCurrentObjectUrl);
    compressCurrentObjectUrl = null;
  }
  compressDownloadWrap.style.display = 'none';
  compressDownloadLink.href = '';
}

function isValidPage(value) {
  return Number.isInteger(value) && value >= 1 && value <= totalPages;
}

async function handleFile(file) {
  updateStatus('');
  clearDownloadLink();
  if (previewContainer) previewContainer.innerHTML = '';
  runBtn.disabled = true;

  if (file.type !== 'application/pdf') {
    updateStatus('File harus berformat PDF.', 'error');
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw new Error('Bukan format PDF yang valid.');
    }

    pdfBytes = bytes;
    loadedPdfDoc = await PDFDocument.load(pdfBytes);
    totalPages = loadedPdfDoc.getPageCount();

    dropText.textContent = 'Klik atau seret file PDF lain untuk mengganti';
    fileName.textContent = file.name;
    fileMeta.textContent = `${totalPages} halaman · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    startPage.max = totalPages;
    endPage.max = totalPages;
    startPage.value = 1;
    endPage.value = totalPages;

    runBtn.disabled = false;
    
    // Render previews asynchronously
    renderPreviews(pdfBytes);
  } catch (error) {
    pdfBytes = null;
    loadedPdfDoc = null;
    totalPages = 0;
    updateStatus('Gagal membaca PDF. Pastikan file tidak rusak atau terkunci password.', 'error');
  }
}

async function handleCompressFile(file) {
  updateCompressStatus('');
  clearCompressDownloadLink();
  compressBtn.disabled = true;
  isCompressing = false; // Reset compression flag

  if (file.type !== 'application/pdf') {
    updateCompressStatus('File harus berformat PDF.', 'error');
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw new Error('Bukan format PDF yang valid.');
    }

    compressPdfBytes = bytes;
    originalFileSize = file.size;
    const doc = await PDFDocument.load(compressPdfBytes);
    const pageCount = doc.getPageCount();

    compressDropText.textContent = 'Klik atau seret file PDF lain untuk mengganti';
    compressFileName.textContent = file.name;
    compressFileMeta.textContent = `${pageCount} halaman · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    compressBtn.disabled = false;
  } catch (error) {
    compressPdfBytes = null;
    originalFileSize = 0;
    isCompressing = false;
    updateCompressStatus('Gagal membaca PDF. Pastikan file tidak rusak atau terkunci password.', 'error');
  }
}

function openFilePicker() {
  fileInput.click();
}

function openCompressFilePicker() {
  compressFileInput.click();
}

function handleDropEvent(event) {
  event.preventDefault();
  dropZone.classList.remove('dragover');

  if (event.dataTransfer.files.length) {
    handleFile(event.dataTransfer.files[0]);
  }
}

function handleCompressDropEvent(event) {
  event.preventDefault();
  compressDropZone.classList.remove('dragover');

  if (event.dataTransfer.files.length) {
    handleCompressFile(event.dataTransfer.files[0]);
  }
}

async function renderPreviews(pdfBytesData) {
  if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) {
    return;
  }
  
  try {
    updateStatus('Memuat preview halaman...');
    const pdf = await pdfjsLib.getDocument({ data: pdfBytesData }).promise;
    const numPages = pdf.numPages;
    const fragment = document.createDocumentFragment();
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.3 });
      
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-item';
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.title = `Halaman ${i} (Klik untuk memilih)`;
      
      const context = canvas.getContext('2d', { alpha: false });
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      const pageLabel = document.createElement('div');
      pageLabel.className = 'preview-page-num';
      pageLabel.textContent = `Hal ${i}`;
      
      canvas.addEventListener('click', () => {
        const currentStart = Number(startPage.value);
        const currentEnd = Number(endPage.value);
        if (i < currentStart) {
          startPage.value = i;
        } else if (i > currentEnd) {
          endPage.value = i;
        } else {
          startPage.value = i;
          endPage.value = i;
        }
      });
      
      wrapper.appendChild(canvas);
      wrapper.appendChild(pageLabel);
      fragment.appendChild(wrapper);
    }
    
    previewContainer.appendChild(fragment);
    updateStatus('');
  } catch (error) {
    console.error('Error rendering previews:', error);
    updateStatus('Gagal memuat sebagian preview.', 'error');
  }
}

function validatePageRange(start, end) {
  if (!isValidPage(start) || !isValidPage(end)) {
    updateStatus('Masukkan nomor halaman yang valid.', 'error');
    return false;
  }
  if (start > end) {
    updateStatus('Halaman awal tidak boleh lebih besar dari halaman akhir.', 'error');
    return false;
  }
  return true;
}

async function splitPdf() {
  const start = Number(startPage.value);
  const end = Number(endPage.value);

  updateStatus('');
  clearDownloadLink();

  if (!pdfBytes) {
    updateStatus('Upload PDF terlebih dahulu.', 'error');
    return;
  }

  if (!validatePageRange(start, end)) {
    return;
  }

  runBtn.disabled = true;
  updateStatus('Memproses...');

  try {
    const srcDoc = loadedPdfDoc;
    const newDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
    const copiedPages = await newDoc.copyPages(srcDoc, indices);

    copiedPages.forEach((page) => newDoc.addPage(page));

    const newPdfBytes = await newDoc.save();
    const blob = new Blob([newPdfBytes], { type: 'application/pdf' });
    currentObjectUrl = URL.createObjectURL(blob);

    downloadLink.href = currentObjectUrl;
    downloadLink.download = `halaman-${start}-${end}.pdf`;
    downloadWrap.style.display = 'block';

    updateStatus(`Selesai! ${indices.length} halaman berhasil diambil.`, 'ok');
  } catch (error) {
    console.error('Error during splitPdf:', error);
    updateStatus('Terjadi kesalahan saat memproses PDF: ' + (error.message || error), 'error');
  } finally {
    runBtn.disabled = false;
  }
}

async function compressPdf() {
  updateCompressStatus('');
  clearCompressDownloadLink();

  // Prevent concurrent compressions
  if (isCompressing) {
    updateCompressStatus('Proses kompresi sedang berjalan. Tunggu sebentar...', 'error');
    return;
  }

  if (!compressPdfBytes) {
    updateCompressStatus('Upload PDF terlebih dahulu.', 'error');
    return;
  }

  compressBtn.disabled = true;
  isCompressing = true;
  updateCompressStatus('Memproses...');

  // Create a copy of compressPdfBytes to prevent interference
  const pdfBytesToCompress = new Uint8Array(compressPdfBytes);
  const fileSizeToCompress = originalFileSize;

  // Validate PDF before processing
  if (pdfBytesToCompress.length < 4 || 
      pdfBytesToCompress[0] !== 0x25 || 
      pdfBytesToCompress[1] !== 0x50 || 
      pdfBytesToCompress[2] !== 0x44 || 
      pdfBytesToCompress[3] !== 0x46) {
    updateCompressStatus('File PDF tidak valid. Silakan upload ulang.', 'error');
    compressBtn.disabled = false;
    isCompressing = false;
    return;
  }

  try {
    const level = parseInt(compressionLevel.value);
    let compressedBytes = null;
    let usedMethod = 'unknown';

    // Set timeout for compression (max 5 minutes)
    const compressionPromise = (async () => {
      // Try canvas-based compression first (better quality reduction)
      if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) {
        try {
          updateCompressStatus('Mempersiapkan PDF...');
          const pdf = await pdfjsLib.getDocument({ data: pdfBytesToCompress }).promise;
          updateCompressStatus('Mengompres dengan rendering (metode tingkat lanjut)...');
          compressedBytes = await compressWithCanvasInternal(level, pdf, pdfBytesToCompress);
          usedMethod = 'canvas';
        } catch (canvasError) {
          console.warn('Canvas compression failed, trying fallback:', canvasError);
          updateCompressStatus('Mengompres (metode alternatif)...');
          compressedBytes = await compressPdfSimpleInternal(level, pdfBytesToCompress);
          usedMethod = 'simple';
        }
      } else {
        // Fallback if pdf.js is not available
        console.warn('PDF.js not available, using simple compression');
        updateCompressStatus('Mengompres...');
        compressedBytes = await compressPdfSimpleInternal(level, pdfBytesToCompress);
        usedMethod = 'simple';
      }
      
      return { compressedBytes, usedMethod };
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5 * 60 * 1000)
    );

    const { compressedBytes: resultBytes, usedMethod: resultMethod } = await Promise.race([
      compressionPromise,
      timeoutPromise
    ]);

    compressedBytes = resultBytes;
    usedMethod = resultMethod;

    if (!compressedBytes || compressedBytes.length === 0) {
      throw new Error('Kompresi gagal - file kosong');
    }

    // Create download link
    const blob = new Blob([compressedBytes], { type: 'application/pdf' });
    compressCurrentObjectUrl = URL.createObjectURL(blob);

    const compressedSize = compressedBytes.length;
    const compressionRatio = ((1 - compressedSize / fileSizeToCompress) * 100).toFixed(1);

    compressDownloadLink.href = compressCurrentObjectUrl;
    compressDownloadLink.download = `hasil-kompres.pdf`;
    compressDownloadWrap.style.display = 'block';

    const beforeMB = (fileSizeToCompress / 1024 / 1024).toFixed(2);
    const afterMB = (compressedSize / 1024 / 1024).toFixed(2);
    
    let message = `Selesai! ${beforeMB}MB → ${afterMB}MB (Kompresi: ${compressionRatio}%)`;
    if (usedMethod === 'simple') {
      message += ' - Gunakan level 5 untuk kompresi lebih baik.';
    }
    
    updateCompressStatus(message, 'ok');
    
  } catch (error) {
    console.error('Compression error:', error);
    let errorMsg = 'Terjadi kesalahan saat mengompres PDF.';
    
    if (error.message.includes('kompresi gagal')) {
      errorMsg = 'Proses kompresi menghasilkan file kosong. Coba file PDF lain.';
    } else if (error.message === 'timeout') {
      errorMsg = 'Proses kompresi terlalu lama (timeout). Coba dengan file PDF yang lebih kecil.';
    } else if (fileSizeToCompress > 100 * 1024 * 1024) {
      errorMsg = 'File PDF terlalu besar (>100MB). Split PDF menjadi bagian lebih kecil terlebih dahulu.';
    } else if (error.message.includes('No PDF header found')) {
      errorMsg = 'File PDF rusak. Silakan upload file PDF yang valid.';
    } else {
      errorMsg = 'Error: ' + (error.message || 'Kesalahan tidak diketahui');
    }
    
    updateCompressStatus(errorMsg, 'error');
  } finally {
    compressBtn.disabled = false;
    isCompressing = false;
  }
}

// SPLIT TAB EVENT LISTENERS
fileInput.addEventListener('change', (event) => {
  if (event.target.files.length) {
    handleFile(event.target.files[0]);
  }
});

dropZone.addEventListener('click', openFilePicker);
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFilePicker();
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', handleDropEvent);

runBtn.addEventListener('click', splitPdf);

// COMPRESS TAB EVENT LISTENERS
compressFileInput.addEventListener('change', (event) => {
  if (event.target.files.length) {
    handleCompressFile(event.target.files[0]);
  }
});

compressDropZone.addEventListener('click', openCompressFilePicker);
compressDropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openCompressFilePicker();
  }
});

compressDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  compressDropZone.classList.add('dragover');
});

compressDropZone.addEventListener('dragleave', () => {
  compressDropZone.classList.remove('dragover');
});
compressDropZone.addEventListener('drop', handleCompressDropEvent);

compressBtn.addEventListener('click', compressPdf);
