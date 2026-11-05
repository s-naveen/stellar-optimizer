# Merge generated JSON (after) into original (before), keeping only additions/changes whose key path matches the allow-list.
import json,sys
before_root,allow=sys.argv[1],set(sys.argv[2].split(','))
files=sys.argv[3:]
def merge(b,a,path):
    if isinstance(b,dict) and isinstance(a,dict):
        out=dict(b)
        for k,v in a.items():
            if k in allow: out[k]=v
            elif k in b: out[k]=merge(b[k],v,path+[k])
        return out
    return b
for f in files:
    b=json.load(open(f'{before_root}/{f}')); a=json.load(open(f))
    m=merge(b,a,[])
    raw=open(f'{before_root}/{f}').read()
    # keep original formatting style (indent detection)
    indent=2 if raw.startswith('{\n  ') else None
    s=json.dumps(m,indent=indent,ensure_ascii=False)
    if raw.endswith('\n'): s+='\n'
    open(f,'w').write(s)
    print('merged',f)
