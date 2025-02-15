
const $ = selector => document.querySelector(selector)
const editors = () => $('.edits')
const ul = () => $('ul')
const get_selected_list_item = () => $('ul li.selected')
const get_element_index = element => Array.from(element.parentNode.children).indexOf(element)
let trace = message => console.log(message)
trace = message => {}

export const make_system = bus => {
	
	bus = bus || Bus()
	let buffers = []
	const list = make_list(bus, () => buffers)
	const system = {}
	return Object.assign(system, { start })
	
	async function start() {
		
		watch_keyboard(bus)
		load()
		listen()
	}
	
	async function load() {
		
		try {
			const key = window.location.hash.slice(1)
			const handle = await obtain_directory_handle(key)
			if (handle) {
				$('.register button').classList.add('registered')
				window.location.hash = `#${handle.key}`
				buffers = await load_buffers(handle, bus)
			}
		} catch (error) {
			console.error(`error: ${error}`)
		}
	}
	
	function listen() {
		
		bus.on('buffer-selected', buffer => {
			if (! buffer.open) buffer.read()
			buffer.show()
		})
		$('.register button').addEventListener('click', async () => load())
	}
}

async function obtain_directory_handle(key) {
	
	let granted = false
	let handle
	if (key) handle = await load_directory_handle(key)
	if (handle) granted = verify_permission(handle)
	if (handle) handle.key = key
	if (granted) return handle
	handle = await window.showDirectoryPicker()
	key = random_string()
	save_directory_handle(key, handle)
	handle.key = key
	return handle
}

async function verify_permission(handle, read_write) {
	
	const options = {}
	if (read_write) options.mode = 'readwrite'
	if ((await handle.queryPermission(options)) === 'granted') return true
	if ((await handle.requestPermission(options)) === 'granted') return true
	return false
}

export const load_directory_handle = (key) => {
	
	return new Promise((resolve, reject) => {
		promise.then(database => {
			const transaction = database.transaction(['handles'], 'readonly')
			const store = transaction.objectStore('handles')
			const request = store.get(key)
			request.onsuccess = event => resolve(event.target.result?.handle)
			request.onerror = () => reject(request.error)
		})
	})
}

export const save_directory_handle = (key, handle) => {
	
	return new Promise((resolve, reject) => {
		promise.then(database => {
			const transaction = database.transaction(['handles'], 'readwrite')
			const store = transaction.objectStore('handles')
			const request = store.put({ id: key, handle })
			request.onsuccess = () => resolve()
			request.onerror = () => reject(request.error)
		})
	})
}

const promise = new Promise((resolve, reject) => {
	
	const request = indexedDB.open('handle', 1)
	request.onupgradeneeded = event => event.target.result.createObjectStore('handles', { keyPath: 'id' })
	request.onsuccess = event => resolve(event.target.result)
	request.onerror = event => reject(event.target.error)
})

async function load_buffers(handle, bus) {
	
	const buffers = []
	async function read_files_in_directory(handle, level = 0) {
		for await (const entry of handle.values()) {
			if (entry.kind === 'file') {
				buffers.push(make_buffer(entry))
			} else if (entry.kind === 'directory') {
				if (entry.name == '.git') return
				buffers.push(make_buffer(entry))
				await read_files_in_directory(entry, level + 1)
			}
		}
	}
	await read_files_in_directory(handle)
	return sort_buffers_by_size(buffers)
}

function sort_buffers_by_size(buffers) {
	
	buffers.sort((a, b) => {
		const a_size = a.file?.size || 0
		const b_size = b.file?.size || 0
		if (a_size < b_size) return 1
		if (a_size > b_size) return -1
		else return 0
	})
	return buffers
}

export const make_buffer = entry => {
	
	let timer
	let open = false
	let text_area
	const buffer = {}
	return Object.assign(buffer, { show, read, write, name })
	
	function show() {
		
		if (! text_area) return
		text_area.activate()
		open = true
	}
	
	async function read() {
		
		if (entry.kind == 'directory') return
		const file = await entry.getFile()
		const text = await file.text()
		text_area = text_area || make_textarea()
		const debounce_write = debounce(() => write(), 500)
		const element = text_area.element
		element.value = text
		element.addEventListener('input', event => {
			text_area.activate()
			debounce_write()
		})
		show()
	}
	
	function write() {
		console.log(`should write buffer: ${entry.name}`)
	}
	
	function name() {
		return entry.kind == 'directory' ? `${entry.name}/` : entry.name
	}
}

export const make_list = (bus, buffers) => {
	
	let open = false
	let index = -1
	const list = { invoke, show, dismiss }
	bus.emit('list-created', list)
	return list
	
	function invoke(direction) {
		
		if (! open) show(true)
		advance(direction)
	}
	
	function show(open_) {
		
		open = open_
		render()
		$('ul li:first-child').scrollIntoView()
		if (open) ul().classList.remove('off')
		else ul().classList.add('off')
	}
	
	function advance(direction) {
		
		index = 1
		let item = get_selected_list_item()
		if (item) index = get_element_index(item) + direction
		if (item) item.classList.remove('selected')
		ul().children[index].classList.add('selected')
	}
	
	function render() {
		
		const array = buffers().map((buffer, index) => `<li>${buffer.name()}</li>`)
		ul().innerHTML = array.join('')
		ul().addEventListener('click', event => {
			const index = get_element_index(event.target)		// broken?
			buffers().unshift(buffers().splice(index, 1)[0])
			bus.emit('buffer-selected', buffers()[0])
			show(false)
		})
	}
	
	function dismiss() {
		
		if (! open) return
		show(false)
		if (index == -1) return
		buffers().unshift(buffers().splice(index, 1)[0])
		bus.emit('buffer-selected', buffers()[0])				
	}
}

export const make_textarea = (element, bus) => {
	
	if (! element) editors().insertAdjacentHTML('beforeend', `<textarea wrap="off" spellcheck="false"></textarea>`)
	if (! element) element = editors().lastElementChild
	bus = bus || make_bus()
	const textarea_ = element
	const textarea = { element }
	init()
	return Object.assign(textarea, { value, activate })
	
	function init() {
		
		history.attach(textarea_)
		textarea_.style.color = '#a6e22e'
		textarea_.style.caretColor = 'white'
	}
	
	function value(value_) {
		
		textarea_.value = value_
		textarea_.dispatchEvent(Object.assign(new InputEvent('input'), { applied: true }))
	}
	
	function activate() {
		
		activate_zindex()
		display.follow(textarea)
	}
	
	function activate_zindex() {
		
		Array.from(editors().children).forEach(each => {
			if (each == textarea_) each.style.zIndex = 1
			else each.style.zIndex = 0
		})
	}
	
	function activate_display() {
		
		Array.from(editors().children).forEach(each => {
			if (each == textarea_) each.style.display = 'block'
			else each.style.display = 'none'
		})
	}
}

export const make_display = element => {
	
	let trace = message => console.log(message)
	trace = () => {}
	const display_ = element
	let textarea_
	let scrolling = false
	const display = { element }
	return Object.assign(display, { follow, render, clear })
	
	function follow(textarea) {
		
		unfollow(textarea_, textarea.element)
		textarea_ = textarea.element
		textarea_.addEventListener('input', on_input)
		textarea_.addEventListener('scroll', on_scroll())
		display_.innerHTML = ''
		display.textarea = textarea
		render({ begin: 0, end: Infinity }, 'javascript')
		display_.scrollTop = textarea_.scrollTop
	}
	
	function unfollow(a, b) {
		
		if (a) a.removeEventListener('input', on_input)
		if (a) a.removeEventListener('scroll', on_scroll())
		if (b) b.removeEventListener('input', on_input)
		if (b) b.removeEventListener('scroll', on_scroll())
	}
	
	function on_input(event) {
		
		if (event.inputType == 'insertText') {
			const line = textarea_.cache.char_index_to_line_index(textarea_.selectionStart)
			render({ begin: line, end: line }, 'javascript')
		} else {
			render(lines_in_view(textarea_), 'javascript')
		}
	}
	
	function on_scroll() {
		
		const debounce_scroll_end = debounce(() => {
			render(lines_in_view(textarea_), 'javascript')
			scrolling = false
		}, 100)
		
		return event => {
			display_.scrollTop = textarea_.scrollTop
			if (! scrolling) display.clear(lines_in_view(textarea_))
			if (! scrolling) scrolling = true
			debounce_scroll_end()
		}
	}
	
	function render(lines, grammar = 'plain') {
		
		trace(`display.render line range: ${JSON.stringify(lines)}`)
		const cache = textarea_.cache = textarea_.cache || make_cache(textarea_)
		const chars = cache.line_range_to_char_range(lines)
		const text = textarea_.value
		let line
		
		parse({ text, lines, chars, grammar }, translate((kind, number, begin, end, text) => {
			if (kind == 'line') new_line(kind, number, begin, end, text)
			else if (kind == 'end') end_of_file(kind, number)
			else highlight(kind, begin, end)
		}))
		
		function new_line(kind, number, begin, end, text) {
			
			trace(`new_line: ${number}`)
			if (number > display_.children.length - 1) {
				line = document.createElement('div')
				line.classList.add('line')
				line.innerHTML = `<div class="number"></div><pre class="code"></pre>`
				Object.assign(line, { begin, end })
				display_.appendChild(line)
			} else {
				line = display_.children[number]
			}
			line.querySelector('.number').innerText = ''
			line.querySelector('.code').innerText = text()
			line.querySelector('.code').style.display = 'block'
		}
		
		function highlight(kind, begin, end) {
			
			trace(`highlight: ${kind}`)
			const code = line.querySelector('.code')
			const range = document.createRange()
			range.setStart(code.firstChild, begin)
			range.setEnd(code.firstChild, end)
			if (CSS.highlights.has(kind)) {
				CSS.highlights.get(kind).add(range)
			} else {
				CSS.highlights.set(kind, new Highlight(range))
			}
		}
		
		function end_of_file(kind, number) {
			
			if (true) return
			const array = Array.from(display_.children).slice(number)
			while (array.length > 0) array.shift().remove()
		}
	}
	
	function clear(lines) {
		
		range(display_.children, lines.end + 2, display_.children.length - 1).forEach((line, index) => {
			line.querySelector('.code').style.display = 'none'
		})
	}
}

export const display = make_display($('.display'))

export const parse = (options, fn) => {
	
	if (options.grammar == 'javascript') parse_javascript(options, fn)
	else if (options.grammar == 'plain_text') parse_plain_text(options, fn)
	else parse_plain_text(options, fn)
}

export const parse_plain_text = ({ text, lines, chars }, fn) => {			// untested
	
	const pattern = Object.values(patterns()).map(pattern => `(${pattern})`).join('|')
	const regex = new RegExp(pattern, 'gm')
	regex.lastIndex = offset = chars.begin || 0
	let line = lines.begin, offset = chars.begin, match
	
	emit_line()
	while ((match = regex.exec(text)) !== null) {
		if (end && match.index > end) break
		if (get_kind(match) == 'newline') emit_line(match)
	}
	emit_end()
	
	function get_kind() {
		
		const array = ['newline']
		return array.filter((item, index) => match[index + 1] !== undefined)[0]
	}
	
	function emit_line() {
		
		if (match) offset = match.index + 1
		const next = text.indexOf('\n', offset)
		const text_ = () => text.substring(offset, next > -1 ? next : text.length)
		fn('line', line, offset, offset, next, text_)
		line++
	}
	
	function emit_end() {
		fn('end', line)
	}
	
	function patterns() {
		return { newline: `\\n` }
	}
}

export const parse_javascript = ({ text, lines, chars }, fn) => {
	
	let trace = message => console.log(message)
	trace = () => {}
	const pattern = Object.values(patterns()).map(pattern => `(${pattern})`).join('|')
	const regex = new RegExp(pattern, 'gm')
	regex.lastIndex = chars.begin || 0
	let line = lines.begin, offset = chars.begin, match
	trace(`lines: ${JSON.stringify(lines)}`)
	trace(`chars: ${JSON.stringify(chars)}`)
	
	emit_line()
	while ((match = regex.exec(text)) !== null) {
		trace(`match: ${JSON.stringify(match)}`)
		if (match.index > chars.end) break
		const kind = get_kind(match)
		if (kind == 'newline') emit_line(match)
		else emit_kind(kind)
	}
	emit_end()
	
	function get_kind() {
		
		const array = ['number', 'string', 'string', 'string', 'boolean', 'boolean', 'comment', 'comment', 'keyword', '?', 'call', '?', 'newline']
		return array.filter((item, index) => match[index + 1] !== undefined)[0]
	}
	
	function emit_line() {
		
		if (match) offset = match.index + 1
		const next = text.indexOf('\n', offset)
		const text_ = () => text.substring(offset, next > -1 ? next : text.length)
		fn('line', line, offset, offset, next, text_)
		line++
	}
	
	function emit_kind(kind) {
		fn(kind, line, offset, match.index, regex.lastIndex, () => match[0])
	}
	
	function emit_end() {
		fn('end', line)
	}
	
	function patterns() {
		
		return {
			number: `\\b\\d+\\b`,
			string: `(["'])(.*?)(['\"])`,
			boolean: `\\b(true|false)\\b`,
			comment: `\/\\/.*?$|\\/\\*[\\s\\S]*?\\*\\/`,
			keyword: `\\b(${keywords().join('|')})\\b`,
			call: `\\b([a-zA-Z0-9_]+)(?=\\()`,
			newline: `\\n`
		}
	}
	
	function keywords() {
		
		const keywords = []
		keywords.push(...['import', 'export'])
		keywords.push(...['var', 'let', 'const'])
		keywords.push(...['if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'break', 'continue'])
		keywords.push(...['function', 'return', 'async', 'await', 'yield'])
		keywords.push(...['try', 'catch', 'finally', 'throw'])
		keywords.push(...['new', 'this', 'super', 'class', 'extends', 'static', 'get', 'set'])
		keywords.push(...['typeof', 'instanceof', 'in', 'delete', 'void', 'debugger', 'with'])
		return keywords
	}
}

const make_cache = textarea => {
	
	const lines = (string, fn) => {
		
		let index = -1, last = -1, line = 0, more = true
		while (more) {
			index = string.indexOf('\n', index + 1)
			const from = last + 1
			const to = index > -1 ? index : string.length
			const text = () => string.substring(from, to)
			const includes = i => (from <= i && i <= to)
			const result = fn(line++, from, to, text, includes)
			more = result === false || index === -1 ? false : more
			last = index
		}
	}
	
	const cache_ = []
	const cache = {}
	return Object.assign(cache, {
		line_range_to_char_range: range => line_range_to_char_range(textarea.value, range),
		char_index_to_line_index: char_index => char_index_to_line_index(textarea.value, char_index),
		invalidate
	})
	
	function line_range_to_char_range(string, range) {
		
		const result = {}
		lines(string, (line, from, to) => {
			if (line === range.begin) result.begin = from
			if (line === range.end) {
				result.end = to
				return false
			}
		})
		return result
	}
	
	function char_index_to_line_index(string, char_index) {
		
		let result
		lines(string, (line, from, to) => {
			if (from <= char_index && char_index <= to) {
				result = line
				return false
			}
		})
		return result
	}
	
	function invalidate(options) {
		return
	}
}

export const translate = fn => {
	
	return (kind, line, offset, begin, end, text) => {
		fn(kind, line, begin - offset, end - offset, text)
	}
}

export const throttle = (fn, delay) => {
	
	let timeout
	return function(...args) {
		if (timeout) return
		timeout = setTimeout(() => {
			fn(...args)
			timeout = null
		}, delay)
	}
}

export const debounce = (fn, timeout = 300) => {
	
	let timer
	return function(...args) {
		clearTimeout(timer)
		timer = setTimeout(function() {
			fn.apply(this, args)
		}, timeout)
	}
}

export const capture_event = (fn, event) => {
	
	fn()
	event.preventDefault()
	event.stopPropagation()
}

export const watch_keyboard = bus => {
	
	watch('keydown')
	watch('keyup')
	watch('keypress')
	
	function watch(type) {
		
		document.addEventListener(type, event => {
			const pattern = [type, event.code.toLowerCase()]
			if (event.ctrlKey) pattern.push('control')
			if (event.shiftKey) pattern.push('shift')
			bus.emit(pattern.join('-'), event)
		})
	}
}

export const lines_in_view = element => {
	
	const line_height = parseFloat(getComputedStyle(element).lineHeight)
	const begin = Math.floor(element.scrollTop / line_height)
	const end = begin + Math.floor(element.clientHeight / line_height) + 1
	return { begin, end }
}

export const range = (array, begin, end) => ({
	
	forEach: fn => {
		
		let i = begin
		while (true) {
			fn(array[i], i)
			if (i === end) break
			i = i + ((end - begin > 0) ? 1 : -1)
		}
	}
})

Array.prototype.range = function(begin, end) {
	return range(this, begin, end)
}

const random_string_36 = (length = 8) => Math.random().toString(36).slice(2, 2 + length)
const random_string_62 = (length = 8) => {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	return Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('')
}
const random_string = random_string_62

export const parse_syntax = parse
export const translate_to_line_positions = translate

export const make_history = () => {
	
	let edits = [], index = -1, then, promoted
	const history = {}
	return Object.assign(history, { undo, redo, attach })
	
	function undo() {
		
		can_undo(edit => {
			edit.undo()
			if (index >= 0) index--
		})
	}
	
	function redo() {
		
		if (index < edits.length - 1) index++
		can_redo(edit => {
			edit.redo()
		})
	}
	
	function can_undo(fn) {
		
		if (index < 0 || index >= edits.length) return
		fn(edits[index])
		changed()
	}
	
	function can_redo(fn) {
		
		if (index < 0 || index >= edits.length) return
		if (! edits[index].redo) return
		fn(edits[index])
		changed()
	}
	
	function changed() {
		
		promoted = null
		if (history.on_change) history.on_change(edits, index)
	}
	
	function attach(textarea) {
		
		let keydown = false, input = false
		textarea.selectionStart = 0
		textarea.selectionEnd = 0
		promoted = capture(textarea)
		listen()
		
		function listen() {
			
			textarea.addEventListener('keydown', event => keydown = true)
			textarea.addEventListener('input', event => input = true)
			textarea.addEventListener('focus', focused)
			textarea.addEventListener('mousedown', event => {
				promoted = capture(textarea)
			})
			textarea.addEventListener('selectionchange', () => {
				then = capture(textarea)
				if (keydown && ! input) promoted = capture(textarea)
				keydown = input = false
			})
			textarea.addEventListener('input', event => {
				if (event.applied) return
				truncate()
				promote()
				edits[index].now = capture(textarea)
				changed()
			})
		}
		
		function truncate() {
			
			if (! (index < edits.length - 1)) return
			edits = edits.slice(0, index + 1)
			advance(then)
		}
		
		function promote() {
			
			if (! promoted) return
			if (! (edits.length === 0 || edits.at(index).now)) return
			advance(promoted)
		}
		
		function advance(props) {
			
			if (edits.at(-1)) edits.at(-1).condense()
			edits.push(make_edit(props))
			index++
		}
		
		function capture(textarea) {
			
			let { value, selectionStart, selectionEnd } = textarea
			return { textarea, value, selectionStart, selectionEnd }
		}
		
		function apply(props) {
			
			const { textarea, value, selectionStart, selectionEnd } = props
			textarea.removeEventListener('focus', focused)
			input = true
			textarea.focus()
			Object.assign(textarea, { value, selectionStart, selectionEnd })
			textarea.dispatchEvent(Object.assign(new InputEvent('input'), { applied: true }))
			textarea.addEventListener('focus', focused)
		}
		
		function focused() {
			promoted = capture(textarea)
		}
		
		function make_edit(then, now) {
			
			const edit = {}
			return Object.assign(edit, {
				then,
				now,
				undo: () => apply_(edit.then),
				redo: () => apply_(edit.now),
				condense,
				to_string
			})
			
			function apply_(props) {
				
				const { textarea, selectionStart, selectionEnd, offset, deleted, inserted } = props
				let { value } = props
				if (offset !== undefined) {
					value = textarea.value
					const head = value.slice(0, offset)
					const tail = value.slice(offset + deleted.length, value.length)
					value = head + inserted + tail
				}
				apply({ textarea, value, selectionStart, selectionEnd })
			}
			
			function condense() {
				
				if (! edit.then || ! edit.now) return
				if (edit.then.offset && edit.now.offset) return
				const then = edit.then.value, now = edit.now.value
				edit.then = combine(edit.then, diff(now, then))
				edit.now = combine(edit.now, diff(then, now))
			}
			
			function combine(props, diff) {
				
				const { textarea, selectionStart, selectionEnd } = props
				return { textarea, selectionStart, selectionEnd, ...diff }
			}
			
			function diff(a, b) {
				
				const begin = find(a, b, 1)
				const end = find(a, b, -1)
				return {
					offset: begin,
					deleted: a.slice(begin, a.length + end + 1),
					inserted: b.slice(begin, b.length + end + 1)
				}
			}
			
			function find(a, b, direction) {
				
				let i = direction === 1 ? 0 : -1
				while (true) {
					if (a.at(i) === undefined) break
					if (b.at(i) === undefined) break
					if (a.at(i) !== b.at(i)) break
					direction === 1 ? i++ : i--
				}
				return i
			}
			
			function to_string(props) {
				
				if (props.offset !== undefined) return `@${props.offset}-${props.deleted}+${props.inserted}`
				else if (props.value !== undefined) return props.value
				else return ''
			}
		}
	}
}

export const history = make_history()

export const make_bus = () => {
	
	const keys = {}
	const bus = {}
	return Object.assign(bus, { on, once, emit })
	
	function on(key, fn) {
		
		keys[key] = keys[key] || []
		keys[key].push(fn)
		return () => keys[key].splice(keys[key].indexOf(fn), 1)
	}
	
	function once(key, fn) {
		const off = on(key, () => off(fn(...arguments)))
	}
	
	function emit(key) {
		
		const arguments__ = Array.from(arguments)
		if (keys['*']) keys['*'].forEach((fn) => fn.apply(this, arguments__))
		const arguments_ = Array.from(arguments).slice(1)
		if (! keys[key]) return
		keys[key].forEach((fn) => fn.apply(this, arguments_))
	}
}
