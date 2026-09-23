import pathlib
import re
import sys

text = pathlib.Path(sys.argv[1]).read_text()
if re.search(r'OK \(\d+ tests?\)', text) and not re.search(r'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed', text):
    print('Android instrumentation tests passed.')
else:
    for offset in range(0, len(text), 2800):
        message = text[offset:offset + 2800].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::error title=Android device test failed::{message}')
    raise SystemExit(1)
