import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2], { readOnly: true })
const total = db.prepare('select count(*) c from cookies').get()
console.log('total cookies', total.c)
const rows = db.prepare('select host_key, name, count(*) c from cookies group by host_key, name order by c desc limit 20').all()
console.log(rows)
db.close()
