# SYS.AI.MAYA.SESAME - validates real packs and every example against the JSON Schemas. One JSONL line per file.
# pip install jsonschema referencing ; python3 test/validate-schemas.py <pack.gz>...
import json, gzip, sys, glob, os, datetime
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
schemas = {os.path.basename(p): json.load(open(p)) for p in glob.glob(os.path.join(root, 'schemas', '*.json'))}
reg = Registry()
for name, s in schemas.items():
    res = Resource.from_contents(s); reg = reg.with_resource(s['$id'], res).with_resource(name, res)
V = {n: Draft202012Validator(s, registry=reg) for n, s in schemas.items()}
out = []
def report(target, schema, n, errs):
    o = {"suite": "lorepack-schemas", "check": "LP-S", "name": f"{target} vs {schema}", "status": "fail" if errs else "pass", "actual": {"items": n, "errors": errs[:5]}, "ts": datetime.datetime.utcnow().isoformat() + "Z"}
    out.append(o); print(json.dumps(o))
def check(target, schema, items):
    errs = []
    for i, x in enumerate(items):
        for e in V[schema].iter_errors(x):
            errs.append(f"#{i} {'/'.join(map(str, e.absolute_path))}: {e.message[:140]}")
            if len(errs) > 20: break
    report(target, schema, len(items), errs)
for p in sys.argv[1:]:
    op = gzip.open if p.endswith('.gz') else open
    check(os.path.basename(p), 'lorepack-record.schema.json', [json.loads(l) for l in op(p, 'rt') if l.strip()])
for p in sorted(glob.glob(os.path.join(root, 'test', 'fixtures', 'ok-*'))):
    op = gzip.open if p.endswith('.gz') else open
    check('fixtures/' + os.path.basename(p), 'lorepack-record.schema.json', [json.loads(l) for l in op(p, 'rt') if l.strip()])
ses = [json.loads(l) for l in open(os.path.join(root, 'examples', 'session.maya.jsonl'))]
check('session.maya requests', 'query-request.schema.json', [x['request'] for x in ses if x['request']['op'] != 'chunks_delete' and x['request']['id'] != 's15'])
check('session.maya responses', 'query-response.schema.json', [x['response'] for x in ses])
check('capabilities.maya.json', 'capability-manifest.schema.json', [json.load(open(os.path.join(root, 'examples', 'capabilities.maya.json')))])
a2a = [json.loads(l) for l in open(os.path.join(root, 'examples', 'a2a-session.jsonl'))][1:]
check('a2a envelopes', 'a2a-envelope.schema.json', [e for x in a2a for e in x['envelopes']])
check('a2a replies', 'a2a-envelope.schema.json', [x['response']['result']['reply'] for x in a2a if x['response'].get('result')])
check('a2a responses', 'query-response.schema.json', [x['response'] for x in a2a])
lines = []
for f in ['verify.maya.jsonl', 'verify.barbelo-0120.jsonl']: lines += [json.loads(l) for l in open(os.path.join(root, 'examples', f))]
if os.path.exists(os.path.join(root, 'test', 'results.jsonl')): lines += [json.loads(l) for l in open(os.path.join(root, 'test', 'results.jsonl'))]
check('check lines (verify + tests)', 'check-result.schema.json', lines)
st = [json.load(open(p)) for p in glob.glob(os.path.join(root, 'examples', 'store', '**', '*.json'), recursive=True)]
check('store files', 'store.schema.json', st)
sys.exit(1 if any(o['status'] == 'fail' for o in out) else 0)
