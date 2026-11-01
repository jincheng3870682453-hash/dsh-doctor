import { DatabaseSync } from 'node:sqlite'
const file = process.argv[2]
const url = 'file:' + file.replace(/\\/g, '/') + '?immutable=1'
const db = new DatabaseSync(url, { readOnly: true })
const total = db.prepare('select count(*) c from cookies').get()
console.log('total cookies', total.c)
const rows = db.prepare('select host_key, name, count(*) c from cookies group by host_key, name order by c desc limit 20').all()
console.log(rows)
const sample = db.prepare('select host_key, name, path, length(encrypted_value) len from cookies order by creation_utc desc limit 10').all()
console.log(sample)
db.close()
