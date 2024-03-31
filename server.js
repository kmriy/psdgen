const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const express = require('express');
const app = express();
const jsonParser = express.json();
const cors = require('cors');
const crypto = require('crypto');
const PSD = require('psd');
const puppeteer = require('puppeteer');


/* read text props from psd */
function getText(psd) {

	const text = [];

	psd.tree().export().children.forEach(element => {

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

	return text;
}


/* writing text */
function generateSvgText(text, newText) {

	const requestBodyText = Object.values(newText);
	const elementsArray = [];
	const fontsArray = [];
	let idCounter = 1;
	text.forEach(item => {

		const x = item.alignment === 'right' ? item.right : item.alignment === 'center' ? item.left + item.width / 2 : item.left;
		const anchor = item.alignment === 'right' ? `text-anchor="end"` : item.alignment === 'center' ? `text-anchor="middle"` : ``;

		if (/\r/.test(item.value)) {
			const textArray = item.value.split('\r');
			const textElement = `
				<text x="${x}" y="${item.top}" fill="${item.color}" style="font-family: ${item.font.join()}" font-size="${item.size}" ${anchor}>
					${textArray.map(() => {
				const tspan = `<tspan id="textLayout${idCounter}" class="textLayout" x="${x}" dy="1em">${requestBodyText[idCounter - 1]}</tspan>`;
				fontsArray.push(item.font);
				idCounter++;
				return tspan;
			}).join('')}
				</text>
			`;
			elementsArray.push(textElement);
		}
		else {
			elementsArray.push(`<text id="textLayout${idCounter}" class="textLayout" x="${x}" y="${item.top}" fill="${item.color}" style="font-family: ${item.font.join()}" font-size="${item.size}" ${anchor} dominant-baseline="hanging">${requestBodyText[idCounter - 1]}</text>`);
			fontsArray.push(item.font);
			idCounter++;
		}
	});

	return { elementsArray, fontsArray };

}


/* get md5 + .png from templates name and JSON body */
async function calculateMd5(name, json) {

	try {
		const stats = await fsPromises.stat((path.join(__dirname, 'templates', name)));
		const mtime = stats.mtimeMs.toString();
		const hash = crypto.createHash('md5').update(mtime + JSON.stringify(json)).digest('hex');
		return hash + '.png';
	}
	
	catch (error) {
		console.error('Error calculating MD5:', error.message);
		return null;
	}

}


app.use(cors());
app.use(express.json());
app.use(express.static('src'));
app.use("/getFont", express.static(path.join(__dirname, 'fonts')));


/* console log request */
app.use((request, response, next) => {
	request.url = decodeURIComponent(request.url);
	console.log(`Request: ${request.method} ${request.url}`);
	next();
});


/* get index.html */
app.get("/", (request, response) => {
	response.sendFile(path.join(__dirname, 'index.html'));
});


/* receive new psd file */
app.post("/newPsd", async (request, response) => {

	try {
		const dirPath = path.join(__dirname, 'templates');
		if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
		const base64Data = [];
		request.on("data", chunk => base64Data.push(chunk));
		request.on("end", async () => {
			const stringData = base64Data.toString().replace('data:application/octet-stream;base64,', '');
			const buffer = Buffer.from(stringData, 'base64');
			const name = decodeURIComponent(request.query.name);
			await fsPromises.writeFile(path.join(dirPath, name), buffer);
			/* const props = await fsPromises.stat(path.join(dirPath, name));
			console.log(props.mtime); */
			response.sendStatus(200);
		})
	}

	catch (error) {
		console.log(error);
		return response.sendStatus(500);
	}

});


/* get current psd file */
app.get("/currentPSD", (request, response) => {

	const name = decodeURIComponent(request.query.name);
	const filePath = path.join(__dirname, 'templates', name);
	const exists = fs.existsSync(filePath);
	if (exists) response.sendFile(filePath);
	else response.sendStatus(404);

});


/* get server fonts list */
app.get("/fonts", async (request, response) => {

	const dirPath = path.join(__dirname, 'fonts');
	if (!fs.existsSync(dirPath)) return response.sendStatus(404);
	const fonts = await fsPromises.readdir(dirPath);
	if (!fonts.length) return response.sendStatus(404);
	response.send({ fonts });

});


/* receive new font */
app.post("/newFont", async (request, response) => {

	try {
		const dirPath = path.join(__dirname, 'fonts');
		if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
		const base64Data = [];
		request.on("data", chunk => base64Data.push(chunk));
		request.on("end", async () => {
			const stringData = base64Data.toString().replace('data:application/octet-stream;base64,', '');
			const buffer = Buffer.from(stringData, 'base64');
			const name = decodeURIComponent(request.query.name);
			await fsPromises.writeFile(path.join(dirPath, name), buffer);
			response.sendStatus(200);
		})
	}

	catch (error) {
		console.log(error);
		return response.sendStatus(500);
	}

});


/* generate png */
app.post("/api/generate", jsonParser, async (request, response) => {

	try {

		const name = decodeURIComponent(request.query.name);
		const filePath = path.join(__dirname, 'templates', name);

		if (!fs.existsSync(filePath)) return response.sendStatus(404);

		const psd = PSD.fromFile(filePath);
		psd.parse();
		const bgLayerInfo = psd.tree().descendants().reduce((sum, current, i) => {
			if (current.width >= sum.width && current.height >= sum.height) return { width: current.width, height: current.height, number: i }
			else return sum;
		}, { width: 0, height: 0, number: 0 });
		await psd.tree().descendants()[bgLayerInfo.number].get('image').saveAsPng(path.join(__dirname, 'backgroundTMP.png'));

		const text = getText(psd);
		const { elementsArray, fontsArray } = generateSvgText(text, request.body);
		const uniqueFonts = fontsArray.flat().reduce((sum, current) => {
			if (!sum.includes(current)) sum.push(current);
			return sum;
		}, []);
		const allFonts = await fsPromises.readdir(path.join(__dirname, 'fonts'));
		const fontsBase64 = [];

		for (const font of allFonts) {
			for (const uniqueFont of uniqueFonts) {
				if (font.replace(/\.([a-z]+\d?)$/i, '') === uniqueFont) {
					const fontBase64 = await fsPromises.readFile(path.join(__dirname, 'fonts', font), { encoding: 'base64' });
					fontsBase64.push({
						name: uniqueFont,
						extension: font.match(/\.([a-z]+\d?)$/i)[1] === 'ttf' ? 'truetype' : font.match(/\.([a-z]+\d?)$/i)[1],
						base64: fontBase64
					});
				}
			}
		}

		const uniqFontsBase64 = fontsBase64.reduce((sum, current) => {
			const name = current.name;
			if (!sum.some((obj) => obj.name === name)) sum.push(current);
			return sum;
		}, []);

		const fontFaceArray = [];
		for (const font of uniqFontsBase64) {
			fontFaceArray.push(`@font-face {
				font-family: "${font.name}";
				src: url(data:font/${font.extension};charset=utf-8;base64,${font.base64}) format("${font.extension}");
			}`);
		}

		const background = await fsPromises.readFile(path.join(__dirname, 'backgroundTMP.png'), { encoding: 'base64' });
		const svg = `<svg width="${bgLayerInfo.width}" height="${bgLayerInfo.height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<style>
					${fontFaceArray.join('')}
				</style>
			</defs>
			<image href="data:image/png;base64,${background}" width="${bgLayerInfo.width}" height="${bgLayerInfo.height}"/>
			${elementsArray.join('')}
		</svg>`;

		const dirPath = path.join(__dirname, 'results');
		if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
		const md5Name = await calculateMd5(name, request.body);
		const resultFilePath = path.join(dirPath, md5Name);

		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		const html = `
			<html>
				<head>
					<style>
						body {
							margin: 0;
							padding: 0;
							overflow: hidden;
						}
					</style>
				</head>
				<body>${svg}</body>
			</html>
		`;
		await page.setContent(html);
		await page.setViewport({ width: bgLayerInfo.width, height: bgLayerInfo.height });
		await page.screenshot({ path: resultFilePath });
		await browser.close();

		await fsPromises.rm((path.join(__dirname, 'backgroundTMP.png')));

		return response.send('/results?name=' + md5Name);

	}

	catch (error) {
		console.log(error);
		return response.sendStatus(500);
	}

});


/* get generation result */
app.get('/results', (request, response) => {
	const md5Name = decodeURIComponent(request.query.name);
	const filePath = path.join(__dirname, 'results', md5Name);
	response.sendFile(filePath);
});


/* unknown requests */
app.use((request, response) => {
	response.sendStatus(404);
});


/* errors handler */
app.use((e, request, response, next) => {
	console.error(e.stack);
});


/* exit handler */
process.on("SIGINT", () => {
	console.log("Server stopped");
	process.exit();
});


/* requests listener */
app.listen(process.env.PORT || 3000, () => console.log(`Listening for requests on port ${process.env.PORT || 3000}...`));