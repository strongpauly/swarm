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
	MOD_NAME,
	SWARM_FLAG,
	SWARM_SIZE_FLAG,
	SWARM_SPEED_FLAG
} from "./constants.mjs";

function createLabel(text) {
	const label = document.createElement("label");
	label.textContent = text;
	return label;
}

function createHint(hint, formGroup) {
	if (!hint) {
		return;
	}
	const p = document.createElement("p");
	p.classList.add("hint");
	p.append(hint);
	formGroup.append(p);
}

function dropDownConfig({ parent, app, flag_name, default_value, values, hint }) {
	const token = app.token ?? app.document;
	let flags = token.flags;
	if (flags === undefined) flags = token.data.flags;

	const formGroup = document.createElement("div");
	formGroup.classList.add("form-group");
	parent.append(formGroup);

	formGroup.append(createLabel("Animation"));

	const formFields = document.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const cur = flags?.[MOD_NAME]?.[flag_name] ?? default_value;
	//parent.append(createLabel(title));
	const input = document.createElement("select");
	input.name = "flags." + MOD_NAME + "." + flag_name;

	for (let o of values) {
		let opt = document.createElement("option");
		opt.innerText = o;
		if (cur === o) opt.classList.add("selected");
		input.append(opt);
	}
	input.value = cur;

	formFields.append(input);

	createHint(hint, formGroup);
}

function textBoxConfig({
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

	const formGroup = document.createElement("div");
	formGroup.classList.add("form-group");
	formGroup.classList.add("slim");
	parent.append(formGroup);

	formGroup.append(createLabel(title));

	const formFields = document.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const input = document.createElement("input");
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
	createHint(hint, formGroup);
}

function createCheckBox({ app, parent, data_name, title, hint }) {
	const token = app.token || app.document;

	const formGroup = document.createElement("div");
	formGroup.classList.add("form-group");
	parent.append(formGroup);

	formGroup.append(createLabel(title));

	const formFields = document.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	const input = document.createElement("input");
	input.name = "flags." + MOD_NAME + "." + data_name;
	input.type = "checkbox";
	input.setAttribute("data-dtype", "Boolean");
	if (token.getFlag(MOD_NAME, data_name)) {
		input.checked = "true";
	}
	formFields.append(input);

	createHint(hint, formGroup);
}

function imageSelector(app, flag_name, title) {
	let data_path = "flags." + MOD_NAME + "." + flag_name;

	let flags = app.token.flags;
	if (flags === undefined) flags = app.token.data.flags;

	let grp = document.createElement("div");
	grp.classList.add("form-group");
	let label = document.createElement("label");
	label.innerText = title;
	let fields = document.createElement("div");
	fields.classList.add("form-fields");

	const button = document.createElement("button");
	button.classList.add("file-picker");
	button.type = "button";
	button.title = "Browse Files";
	button.tabindex = "-1";
	button.dataset.target = data_path;
	button["data-type"] = "imagevideo";
	button["data-target"] = data_path;

	button.onclick = app._activateFilePicker.bind(app);

	let bi = document.createElement("i");
	bi.classList.add("fas");
	bi.classList.add("fa-file-import");
	bi.classList.add("fa-fw");

	const inpt = document.createElement("input");
	inpt.name = data_path;
	inpt.classList.add("image");
	inpt.type = "text";
	inpt.title = title;
	inpt.placeholder = "path/image.png";
	// Insert the flags current value into the input box
	if (flags?.[MOD_NAME]?.[flag_name]) {
		inpt.value = flags?.[MOD_NAME]?.[flag_name];
	}

	button.append(bi);

	grp.append(label);
	grp.append(fields);

	fields.append(button);
	fields.append(inpt);
	return grp;
}

// Hook into the token config render
Hooks.on("renderTokenConfig", (app, html, data) => {
	if (!game.user.isGM) return;

	// Create a new form group
	const fieldSet = document.createElement("fieldset");

	// Create a legend for this setting
	const legend = document.createElement("legend");
	legend.textContent = "Swarm";
	fieldSet.append(legend);

	createCheckBox({
		app,
		parent: fieldSet,
		data_name: SWARM_FLAG,
		title: "Swarm Enabled",
		hint: "Whether this token is a swarm."
	});
	textBoxConfig({
		app,
		parent: fieldSet,
		flag_name: SWARM_SIZE_FLAG,
		title: "Count",
		placeholder: 20,
		default_value: 20,
		step: 1,
		hint: "Number of sprites in the swarm."
	});
	textBoxConfig({
		app,
		parent: fieldSet,
		flag_name: SWARM_SPEED_FLAG,
		title: "Speed",
		placeholder: 1.0,
		default_value: 1.0,
		step: 0.1,
		hint: "Animation speed for the swarm."
	});
	dropDownConfig({
		app,
		parent: fieldSet,
		flag_name: ANIM_TYPE_FLAG,
		values: ANIM_TYPES,
		default_value: ANIM_TYPE_CIRCULAR,
		hint: "Animation style for the swarm."
	});

	let appearanceTab = html[0].querySelector("div[data-tab='appearance']");
	if (!appearanceTab) {
		// Since v13 Application V2 passes root html
		appearanceTab = html.querySelector("div[data-tab='appearance']");
	}
	// Add the form group to the bottom of the Appearance tab
	appearanceTab.append(fieldSet);

	// Add difference swarm image
	//const swarmImage = imageSelector(app, SWARM_IMAGE_FLAG, "Token for Swarm mobs");
	// And add the token image selectors to the 'apperance' tab
	//html[0].querySelector("div[data-tab='appearance']").append(swarmImage);

	// Set the apps height correctly
	app.setPosition();
});
