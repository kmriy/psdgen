const PSD = require('psd');


/* get hash */
String.prototype.hashCode = function () {

	const lastDotIndex = this.lastIndexOf('.');
	let name = '';
    let extension = '';

    if (lastDotIndex === -1) name = this;
	else {
		name = this.slice(0, lastDotIndex);
		extension = this.slice(lastDotIndex);
	}

	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		const char = name.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0;
		console.log(hash)
	}

	return Math.abs(hash) + extension;
};


/* load file from server */
(async () => {

	const currentPSD = localStorage.getItem('currentPSD');
	if (!currentPSD) return;
	const response = await fetch('/currentPSD?name=' + encodeURIComponent(currentPSD));
	if (response.status === 404) return localStorage.removeItem('currentPSD');
	const buffer = await response.arrayBuffer();
	const result = await PSD.fromDroppedFile(new Blob([buffer]));
	renderer(result, currentPSD);

})();


/* input psd file handler */
const inputPsdFile = document.querySelector('.Payload input');
inputPsdFile.addEventListener('change', async event => {

	const source = event.target.files[0];
	const name = event.target.files[0].name.hashCode();


	/* send file to server */
	const reader = new FileReader();
	reader.onload = async e => {
		const response = await fetch('/newPsd?name=' + encodeURIComponent(name), {
			method: 'POST',
			body: e.target.result
		});
		if (response.status === 200) localStorage.setItem('currentPSD', name);
	};
	reader.readAsDataURL(source);


	/* getting psd */
	await source.arrayBuffer();
	event.dataTransfer = { files: event.target.files };
	const result = await PSD.fromEvent(event);
	renderer(result, name);

	//console.log(name, result);
	//console.log(result.tree().children());

});


/* building page elements */
async function renderer(result, psdName) {

	/* remove old items */
	document.querySelector('.Fonts').classList.remove('hidden');
	document.querySelector('.InputList').innerHTML = '';
	document.querySelector('.Fonts__List').innerHTML = '';
	Array.from(document.querySelector('svg').children).forEach(child => {
		if (child.tagName !== 'image') child.remove();
	});


	/* image rendering */
	const base64 = result.image.toBase64();
	const outputDiv = document.querySelector('.Renderer__ImageContainer');
	const outputSvg = document.querySelector('.Renderer svg');
	const outputSvgImage = outputSvg.firstElementChild;
	outputDiv.style.background = `url(${base64})`;
	outputSvg.setAttribute('viewBox', `0 0 ${result.image.width()} ${result.image.height()}`);
	outputSvgImage.setAttribute('width', result.image.width());
	outputSvgImage.setAttribute('height', result.image.height());
	outputSvgImage.setAttribute('href', base64);


	/* write current psd name */
	const nameElement = document.querySelector('.Name');
	nameElement.classList.remove('hidden');
	nameElement.textContent = `Хеш-назва шаблону: ${psdName}`;

	
	/* getting text */
	const text = [];
	//console.log(result.tree().export().children)
	result.tree().export().children.forEach(element => {

		if (!element.visible) return;
		for (child of element.children) {

			if (!child.text?.value) continue;

			text.push({
				width: child.width,
				height: child.height,
				top: child.top,
				right: child.right,
				bottom: child.bottom,
				left: child.left,
				alignment: child.text.font.alignment[0],
				value: child.text.value,
				font: child.text.font.names,
				size: child.text.font.sizes[0] * (child.text.transform?.yy || 1),
				color: `rgb(${child.text.font.colors[0].slice(0, 3).map(color => 255 - color).join()})`
			});

		}

	});


	/* drawing borders */
	text.forEach(item => {
		outputSvg.insertAdjacentHTML('beforeend', `<rect x="${item.left}" y="${item.top}" width="${item.width}" height="${item.height}" fill="none" stroke="black" stroke-width="2"/>`)
	});


	/* writing text */
	//console.log(text);
	const fontsArray = [];
	let idCounter = 1;
	text.forEach(item => {

		const x = item.alignment === 'right' ? item.right : item.alignment === 'center' ? item.left + item.width / 2 : item.left;
		const anchor = item.alignment === 'right' ? `text-anchor="end"` : item.alignment === 'center' ? `text-anchor="middle"` : ``;

		if (/\r/.test(item.value)) {
			const textArray = item.value.split('\r');
			const textElement = `
				<text x="${x}" y="${item.top}" fill="${item.color}" stroke="rgba(0, 0, 0, .5)" stroke-width="2" font-family="${item.font.join()}" font-size="${item.size}" ${anchor}>
					${textArray.map(element => {
						const tspan = `<tspan id="textLayout${idCounter}" class="textLayout" x="${x}" dy="1em">${element}</tspan>`;
						fontsArray.push(item.font);
						idCounter++;
						return tspan;
					}).join('')}
				</text>
			`;
			outputSvg.insertAdjacentHTML('beforeend', textElement);
		}
		else {
			outputSvg.insertAdjacentHTML('beforeend', `<text id="textLayout${idCounter}" class="textLayout" x="${x}" y="${item.top}" fill="${item.color}" stroke="rgba(0, 0, 0, .5)" stroke-width="2" font-family="${item.font.join()}" font-size="${item.size}" ${anchor} dominant-baseline="hanging">${item.value}</text>`);
			fontsArray.push(item.font);
			idCounter++;
		}
	});


	/* create inputs and fonts*/
	const uniqueFonts = fontsArray.flat().reduce((sum, current) => {
		if (!sum.includes(current)) sum.push(current);
		return sum;
	}, []);
	document.querySelector('.Fonts__List').insertAdjacentHTML('beforeend', uniqueFonts.map(font => `
		<li class="${font}">
			<label>
				${font}
				<input type="file" accept=".ttf, .otf, .woff" />
			</label>
		</li>
	`).join(''));

	const InputList = document.querySelector('.InputList');
	const textLayouts = Array.from(document.getElementsByClassName('textLayout'));

	textLayouts.forEach((item, i) => {
		const li = document.createElement('li');
		li.insertAdjacentHTML('beforeend', `
			<input id="input${i + 1}" value="${item.textContent}" oninput="textChange(event)">
			${fontsArray[i].map(font => `<span class="${font}">${font}</span>`).join(", ")}
		`);
		InputList.append(li);
	});


	/* searching for fonts */
	const response = await fetch('/fonts');
	if (response.status === 404) uniqueFonts.forEach(font => {
		const elementsArray = Array.from(document.getElementsByClassName(font));
		for (key of elementsArray) key.classList.add('red');
	});
	else if (response.status === 200) {
		const result = await response.json();
		const existingFonts = result.fonts;
		for (font of uniqueFonts) {
			const existingFont = existingFonts.find(item => item.replace(/\.[a-z]+\d?$/i, '') === font);
			if (existingFont) {
				const fontFace = new FontFace(font, `url(getFont/${existingFont})`);
				await fontFace.load();
				document.fonts.add(fontFace);
			}
			
			const elementsArray = Array.from(document.getElementsByClassName(font));
			elementsArray.forEach(key => {
				if (existingFonts.find(item => item.replace(/\.[a-z]+\d?$/i, '') === font)) key.classList.add('green');
				else key.classList.add('red');
			});
		}
	}


	/* add input font handlers */
	const inputFontFile = Array.from(document.querySelectorAll('.Fonts__List input'));
	inputFontFile.forEach(input => {
		input.addEventListener('change', uploadFont);
	})

}


/* input text handler */
function textChange(event) {
	const number = event.target.id.replace('input', '');
	const textLayout = document.getElementById(`textLayout${number}`);
	textLayout.textContent = event.target.value;
}


/* input font file handler */
async function uploadFont(event) {

	const source = event.target.files[0];
	const name = event.target.parentElement.textContent.trim();
	const extension = source.name.match(/\.[a-z]+\d?$/i)[0];
	const reader = new FileReader();
	reader.onload = async e => {
		const response = await fetch(`/newFont?name=${encodeURIComponent(name)}${extension}`, {
			method: 'POST',
			body: e.target.result
		});
		if (response.status === 200) {
			const elementsArray = Array.from(document.getElementsByClassName(name));
			elementsArray.forEach(element => {
				element.classList.remove('red');
				element.classList.add('green');
			});
			const fontFace = new FontFace(name, `url(getFont/${name}${extension})`);
			await fontFace.load();
			document.fonts.add(fontFace);
		}
	};
	reader.readAsDataURL(source);

};

/* checkbox handler for borders*/
const checkboxBorders = document.querySelector('.Fonts__MarkerContainer input');
checkboxBorders.addEventListener('change', () => {
	const rectArray = Array.from(document.querySelectorAll('.Renderer rect'));
	if (checkboxBorders.checked) {
		rectArray.forEach(rect => {
			rect.setAttribute('stroke', 'black');
		});
	}
	else {
		rectArray.forEach(rect => {
			rect.setAttribute('stroke', 'none');
		});
	}
});
