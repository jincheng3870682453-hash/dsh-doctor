import { sanitizeText } from '../plugin/lib/index.js'

const cases = [
	['path C:\\Users\\John Doe\\Desktop x', 'path C:\\Users\\user\\Desktop x'],
	['/home/john doe/project', '/home/user/project'],
	['/Users/john doe/Library', '/Users/user/Library'],
	['C:\\Users\\jincheng3870682453@gmail.com\\x', 'C:\\Users\\user\\x'],
]
let failed = 0
for (const [input, expected] of cases) {
	const got = sanitizeText(input)
	if (got !== expected) {
		failed += 1
		console.log('FAIL:', JSON.stringify(input), '->', JSON.stringify(got), 'expected', JSON.stringify(expected))
	} else {
		console.log('ok:', JSON.stringify(got))
	}
}
process.exit(failed === 0 ? 0 : 1)
