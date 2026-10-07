import { checkDeclaration, contentMatchesType, sanitizeFileName } from './file-rules';

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);
const MB = 1024 * 1024;

describe('checkDeclaration', () => {
  it('accepts an allowed type within its limit', () => {
    expect(checkDeclaration('photo.png', 'image/png', 2 * MB)).toEqual({ ok: true });
    expect(checkDeclaration('clip.mp4', 'video/mp4', 90 * MB)).toEqual({ ok: true });
  });

  it('rejects types that are not on the allow list', () => {
    for (const mime of ['application/x-msdownload', 'image/svg+xml', 'text/html', 'application/zip', 'application/javascript']) {
      expect(checkDeclaration('file.bin', mime, 1000).ok).toBe(false);
    }
  });

  it('enforces the size limit per type: 10 MB for images and docs, 100 MB for video', () => {
    expect(checkDeclaration('a.png', 'image/png', 10 * MB + 1).ok).toBe(false);
    expect(checkDeclaration('a.pdf', 'application/pdf', 10 * MB).ok).toBe(true);
    expect(checkDeclaration('a.mp4', 'video/mp4', 100 * MB).ok).toBe(true);
    expect(checkDeclaration('a.mp4', 'video/mp4', 100 * MB + 1).ok).toBe(false);
  });

  it('rejects empty and non-integer sizes', () => {
    expect(checkDeclaration('a.png', 'image/png', 0).ok).toBe(false);
    expect(checkDeclaration('a.png', 'image/png', -5).ok).toBe(false);
    expect(checkDeclaration('a.png', 'image/png', 1.5).ok).toBe(false);
  });

  it('rejects an extension that does not match the declared type', () => {
    expect(checkDeclaration('virus.exe', 'image/png', 1000).ok).toBe(false);
    expect(checkDeclaration('noextension', 'image/png', 1000).ok).toBe(false);
    expect(checkDeclaration('PHOTO.JPG', 'image/jpeg', 1000).ok).toBe(true);
  });
});

describe('contentMatchesType (magic bytes, not file names)', () => {
  it('recognises real file signatures', () => {
    expect(contentMatchesType('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe(true);
    expect(contentMatchesType('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatchesType('application/pdf', text('%PDF-1.7 ...'))).toBe(true);
    expect(contentMatchesType('image/gif', text('GIF89a....'))).toBe(true);
    expect(contentMatchesType('video/mp4', Uint8Array.from([0, 0, 0, 0x18, ...text('ftypmp42')]))).toBe(true);
    expect(contentMatchesType('text/plain', text('just some notes\nsecond line'))).toBe(true);
  });

  it('rejects a file whose bytes do not match the declared type', () => {
    // An executable (MZ header) renamed and declared as a PNG.
    expect(contentMatchesType('image/png', bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(contentMatchesType('application/pdf', text('<html><script>alert(1)</script>'))).toBe(false);
    expect(contentMatchesType('image/jpeg', bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(contentMatchesType('text/plain', bytes(0x00, 0x01, 0x02, 0x03))).toBe(false);
  });

  it('rejects empty content and unknown types', () => {
    expect(contentMatchesType('image/png', bytes())).toBe(false);
    expect(contentMatchesType('application/x-unknown', bytes(1, 2, 3))).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('strips paths and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('bad<name>"x".png')).toBe('badnamex.png');
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('caps the length', () => {
    expect(sanitizeFileName('a'.repeat(500) + '.png').length).toBeLessThanOrEqual(150);
  });
});

describe('spreadsheets, presentations and CSV', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const zipHead = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);

  it('accepts .xlsx, .pptx and .csv within 10 MB', () => {
    expect(checkDeclaration('marks.xlsx', XLSX, 5 * MB)).toEqual({ ok: true });
    expect(checkDeclaration('slides.pptx', PPTX, 10 * MB)).toEqual({ ok: true });
    expect(checkDeclaration('export.csv', 'text/csv', 1 * MB)).toEqual({ ok: true });
    expect(checkDeclaration('marks.xlsx', XLSX, 10 * MB + 1).ok).toBe(false);
  });

  it('still refuses macro-enabled and legacy Office files, and archives', () => {
    expect(checkDeclaration('macro.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 1000).ok).toBe(false);
    expect(checkDeclaration('old.xls', 'application/vnd.ms-excel', 1000).ok).toBe(false);
    expect(checkDeclaration('old.ppt', 'application/vnd.ms-powerpoint', 1000).ok).toBe(false);
    expect(checkDeclaration('data.zip', 'application/zip', 1000).ok).toBe(false);
  });

  it('needs the right extension for each type', () => {
    expect(checkDeclaration('marks.csv', XLSX, 1000).ok).toBe(false);
    expect(checkDeclaration('slides.xlsx', PPTX, 1000).ok).toBe(false);
    expect(checkDeclaration('table.xlsx', 'text/csv', 1000).ok).toBe(false);
  });

  it('checks the real content', () => {
    expect(contentMatchesType(XLSX, zipHead)).toBe(true);
    expect(contentMatchesType(PPTX, zipHead)).toBe(true);
    expect(contentMatchesType('text/csv', text('name,marks\nAsha,91\n'))).toBe(true);
    // An executable, a PDF or a binary blob pretending to be one of these is refused.
    expect(contentMatchesType(XLSX, bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(contentMatchesType(PPTX, text('%PDF-1.7'))).toBe(false);
    expect(contentMatchesType('text/csv', bytes(0x50, 0x4b, 0x03, 0x04, 0x00))).toBe(false);
  });
});
