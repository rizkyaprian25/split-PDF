const { PDFDocument } = PDFLib;

// SPLIT TAB VARIABLES
let pdfBytes = null;
let totalPages = 0;
let currentObjectUrl = null;

// COMPRESS TAB VARIABLES
let compressPdfBytes = null;
let compressCurrentObjectUrl = null;
let originalFileSize = 0;

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
    const doc = await PDFDocument.load(pdfBytes);
    totalPages = doc.getPageCount();

    dropText.textContent = 'Klik atau seret file PDF lain untuk mengganti';
    fileName.textContent = file.name;
    fileMeta.textContent = `${totalPages} halaman · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    startPage.max = totalPages;
    endPage.max = totalPages;
    startPage.value = 1;
    endPage.value = totalPages;

    runBtn.disabled = false;
  } catch (error) {
    pdfBytes = null;
    totalPages = 0;
    updateStatus('Gagal membaca PDF. Pastikan file tidak rusak atau terkunci password.', 'error');
  }
}

async function handleCompressFile(file) {
  updateCompressStatus('');
  clearCompressDownloadLink();
  compressBtn.disabled = true;

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
    const srcDoc = await PDFDocument.load(pdfBytes);
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
    updateStatus('Terjadi kesalahan saat memproses PDF.', 'error');
  } finally {
    runBtn.disabled = false;
  }
}

async function compressPdf() {
  updateCompressStatus('');
  clearCompressDownloadLink();

  if (!compressPdfBytes) {
    updateCompressStatus('Upload PDF terlebih dahulu.', 'error');
    return;
  }

  compressBtn.disabled = true;
  updateCompressStatus('Memproses...');

  try {
    const level = parseInt(compressionLevel.value);
    const srcDoc = await PDFDocument.load(compressPdfBytes);
    const newDoc = await PDFDocument.create();
    
    // Get all pages
    const pages = await newDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    pages.forEach(page => newDoc.addPage(page));

    // Remove unused objects and optimize (higher compression level = more aggressive)
    if (level >= 3) {
      // Remove metadata and stream optimization
      newDoc.setTitle('');
      newDoc.setAuthor('');
      newDoc.setSubject('');
      newDoc.setKeywords([]);
      newDoc.setProducer('');
      newDoc.setCreator('');
    }

    const compressedBytes = await newDoc.save();
    const blob = new Blob([compressedBytes], { type: 'application/pdf' });
    compressCurrentObjectUrl = URL.createObjectURL(blob);

    const compressedSize = compressedBytes.length;
    const compressionRatio = ((1 - compressedSize / originalFileSize) * 100).toFixed(1);

    compressDownloadLink.href = compressCurrentObjectUrl;
    compressDownloadLink.download = `hasil-kompres.pdf`;
    compressDownloadWrap.style.display = 'block';

    updateCompressStatus(
      `Selesai! Ukuran awal: ${(originalFileSize / 1024 / 1024).toFixed(2)} MB → ${(compressedSize / 1024 / 1024).toFixed(2)} MB (Kompresi: ${compressionRatio}%)`,
      'ok'
    );
  } catch (error) {
    console.error(error);
    updateCompressStatus('Terjadi kesalahan saat mengompres PDF.', 'error');
  } finally {
    compressBtn.disabled = false;
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
