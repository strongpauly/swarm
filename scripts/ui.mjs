/*
 █████  █████ █████
░░███  ░░███ ░░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░░████████   █████
 ░░░░░░░░   ░░░░░  */

import {
	ANIM_TYPE_CIRCULAR,
	ANIM_TYPE_FLAG,
	ANIM_TYPES,
	DEFAULT_ANIMATION,
	DEFAULT_SWARM_SIZE,
	DEFAULT_SWARM_SPEED,
	LOCALIZATION_ROOT,
	MOD_NAME,
	SWARM_FLAG,
	SWARM_SIZE_FLAG,
	SWARM_SPEED_FLAG
} from "./constants.mjs";

function createLabel(doc, text) {
	const label = doc.createElement("label");
	label.textContent = text;
	return label;
}

function createHint(doc, hint, formGroup) {
	if (!hint) {
		return;
	}
	const p = doc.createElement("p");
	p.classList.add("hint");
	p.append(hint);
	formGroup.append(p);
}

function dropDownConfig({
	doc,
	parent,
	app,
	flag_name,
	default_value,
	values,
	hint,
	label,
	getOptionLabel = (option) => option
}) {
	const token = app.token ?? app.document;
	let flags = token.flags;
	if (flags === undefined) flags = token.data.flags;

	const formGroup = doc.createElement("div");
	formGroup.classList.add("form-group");
	parent.append(formGroup);

	formGroup.append(createLabel(doc, label));

	const formFields = doc.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const cur = flags?.[MOD_NAME]?.[flag_name] ?? default_value;
	//parent.append(createLabel(title));
	const input = doc.createElement("select");
	input.name = "flags." + MOD_NAME + "." + flag_name;

	for (let o of values) {
		let opt = doc.createElement("option");
		opt.value = o;
		opt.innerText = getOptionLabel(o);
		if (cur === o) opt.classList.add("selected");
		input.append(opt);
	}
	input.value = cur;

	formFields.append(input);

	createHint(doc, hint, formGroup);
}

function textBoxConfig({
	doc,
	parent,
	app,
	flag_name,
	title,
	type = "number",
	placeholder = null,
	default_value = null,
	step = null,
	hint
}) {
	const token = app.token ?? app.document;
	let flags = token.flags;
	if (flags === undefined) flags = token.data.flags;

	const formGroup = doc.createElement("div");
	formGroup.classList.add("form-group");
	formGroup.classList.add("slim");
	parent.append(formGroup);

	formGroup.append(createLabel(doc, title));

	const formFields = doc.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const input = doc.createElement("input");
	input.name = "flags." + MOD_NAME + "." + flag_name;
	input.type = type;
	if (step) input.step = step;
	if (placeholder) input.placeholder = placeholder;

	if (flags?.[MOD_NAME]?.[flag_name]) {
		input.value = flags?.[MOD_NAME]?.[flag_name];
	} else if (default_value != null) {
		input.value = default_value;
	}
	formFields.append(input);
	createHint(doc, hint, formGroup);
}

function createCheckBox({ app, doc, parent, data_name, title, hint }) {
	const token = app.token || app.document;

	const formGroup = doc.createElement("div");
	formGroup.classList.add("form-group");
	parent.append(formGroup);

	formGroup.append(createLabel(doc, title));

	const formFields = doc.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const input = doc.createElement("input");
	input.name = "flags." + MOD_NAME + "." + data_name;
	input.type = "checkbox";
	input.setAttribute("data-dtype", "Boolean");
	if (token.getFlag(MOD_NAME, data_name)) {
		input.checked = "true";
	}
	formFields.append(input);

	createHint(doc, hint, formGroup);
}

const swarmsRenderConfig = (objectName) => (app, html, data, options) => {
	if (!game.user.isGM) return;

	const doc = app.element?.ownerDocument || document;

	const tab = "appearance";

	if (options?.parts && !options.parts.includes(tab)) {
		return;
	}

	// Create a new form group
	const fieldSet = doc.createElement("fieldset");

	// Create a legend for this setting
	const legend = doc.createElement("legend");
	legend.textContent = "Swarm";
	fieldSet.append(legend);

	createCheckBox({
		app,
		doc,
		parent: fieldSet,
		data_name: SWARM_FLAG,
		default_value: false,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.swarmEnabledTitle`),
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.swarmEnabledHint`, { objectName })
	});
	textBoxConfig({
		app,
		doc,
		parent: fieldSet,
		flag_name: SWARM_SIZE_FLAG,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.countTitle`),
		placeholder: DEFAULT_SWARM_SIZE,
		default_value: DEFAULT_SWARM_SIZE,
		step: 1,
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.countHint`)
	});
	textBoxConfig({
		app,
		doc,
		parent: fieldSet,
		flag_name: SWARM_SPEED_FLAG,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.speedTitle`),
		placeholder: DEFAULT_SWARM_SPEED,
		default_value: DEFAULT_SWARM_SPEED,
		step: 0.1,
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.speedHint`)
	});
	dropDownConfig({
		app,
		doc,
		parent: fieldSet,
		flag_name: ANIM_TYPE_FLAG,
		values: ANIM_TYPES,
		default_value: DEFAULT_ANIMATION,
		label: game.i18n.format(`${LOCALIZATION_ROOT}.animationTitle`),
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.animationHint`),
		getOptionLabel: (option) => game.i18n.format(`${LOCALIZATION_ROOT}.animation.${option}`)
	});

	let appearanceTab = html[0].querySelector(`div[data-tab='${tab}']`);
	if (!appearanceTab) {
		// Since v13 Application V2 passes root html
		appearanceTab = html.querySelector(`div[data-tab='${tab}']`);
	}
	// Add the form group to the bottom of the Appearance tab
	appearanceTab.append(fieldSet);

	// Set the apps height correctly
	app.setPosition();
};

Hooks.on("renderTokenConfig", swarmsRenderConfig("token"));
Hooks.on("renderPrototypeTokenConfig", swarmsRenderConfig("token"));
Hooks.on("renderTileConfig", swarmsRenderConfig("tile"));
