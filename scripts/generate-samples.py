"""Generate the small, real documents and audio used by the browser-only demo."""
from pathlib import Path
import math, struct, wave

out = Path(__file__).parent.parent / 'public' / 'samples'
out.mkdir(parents=True, exist_ok=True)

def pdf(filename, pages):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']
    kids = []
    for title, subtitle, lines in pages:
        stream = '0.96 0.97 0.95 rg 0 0 612 792 re f\n0.15 0.29 0.21 rg\n'
        stream += f'BT /F2 12 Tf 55 728 Td (FINDEX / FIELD NOTES) Tj ET\n'
        stream += f'BT /F2 31 Tf 55 638 Td ({title}) Tj ET\n'
        stream += f'BT /F1 13 Tf 55 605 Td ({subtitle}) Tj ET\n'
        for i, line in enumerate(lines):
            line = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            stream += f'BT /F1 12 Tf 55 {535-i*25} Td ({line}) Tj ET\n'
        stream += f'BT /F1 10 Tf 55 55 Td (Findex demo document - {len(kids)+1}) Tj ET'
        stream_bytes = stream.encode('latin1')
        page_id = len(objects) + 1
        content_id = page_id + 1
        kids.append(f'{page_id} 0 R')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>'.encode())
        objects.append(f'<< /Length {len(stream_bytes)} >>\nstream\n'.encode() + stream_bytes + b'\nendstream')
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'.encode()
    content = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(content)); content.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(content); content.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]: content.extend(f'{offset:010} 00000 n \n'.encode())
    content.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
    (out / filename).write_bytes(content)

pdf('brand-guidelines.pdf', [
 ('Room for the important.', 'Findex / Brand guidelines / September 2026', [
  'A considered home for everything you keep.', '',
  '01   Our point of view',
  'Technology should feel like a little less, not a little more.',
  'We make space for your ideas by taking care of the files behind them.', '',
  '02   Clear, calm, capable',
  'Every interaction has a purpose. Every detail earns its place.',
  'We choose quiet confidence over noise, and clarity over clutter.', '',
  'This is a real, locally generated sample PDF for the Findex preview.'
 ]),
 ('Naturally, Findex.', 'A simple visual language, thoughtfully applied.', [
  '03   Our palette',
  'Evergreen    #244B36',
  'Soft sage    #DFE8D8',
  'Warm canvas  #F4F6F1',
  'Ink          #26372E', '',
  '04   A little room to breathe',
  'Generous spacing. Soft surfaces. Purposeful typography.',
  'Let the content take the lead.', '',
  '05   Useful, not ornamental',
  'Use familiar functional icons. Never decorate intelligence.'
 ])
])
pdf('cv.pdf', [('Alex Morgan', 'Product designer / Curriculum vitae', [
 'Thoughtful products for everyday people.', '',
 'Experience', '2023 - Present   Senior Product Designer, Independent',
 '2020 - 2023      Product Designer, North Studio', '',
 'Skills', 'Interaction design, design systems, prototyping, research', '',
 'Education', 'BA, Visual Communication', '',
 'A fictional sample CV for testing natural language file search.'
])])
rate, duration = 22050, 14
with wave.open(str(out / 'sunday-mornings.wav'), 'wb') as audio:
    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
    samples = bytearray()
    for i in range(rate * duration):
        t = i / rate; fade = min(1, t / 2, (duration - t) / 3)
        value = sum(math.sin(2 * math.pi * f * t) for f in (220, 277.18, 329.63)) / 3
        samples.extend(struct.pack('<h', int(value * 4500 * max(0, fade))))
    audio.writeframes(samples)
