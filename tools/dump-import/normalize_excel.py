import json,struct,sys,os
src,dst,files=sys.argv[1],sys.argv[2],sys.argv[3:]
def f32(x): return struct.unpack('f',struct.pack('f',x))[0]
def short(x):
    if x!=x or x in (float('inf'),float('-inf')): return x
    t=f32(x)
    if t!=x: return x  # not a float32 value; leave
    for p in range(1,18):
        r=float(f'{x:.{p}g}')
        if f32(r)==t: return int(r) if r.is_integer() and abs(r)<2**53 and False else r
    return x
def walk(o):
    if isinstance(o,float): return short(o)
    if isinstance(o,list): return [walk(v) for v in o]
    if isinstance(o,dict): return {k:walk(v) for k,v in o.items()}
    return o
os.makedirs(dst,exist_ok=True)
for f in files:
    d=json.load(open(f'{src}/{f}'))
    json.dump(walk(d),open(f'{dst}/{f}','w'),ensure_ascii=False)
print('done',len(files))
