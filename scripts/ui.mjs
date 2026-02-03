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

function createSelect({
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

	const options = values.map((value) => ({ value, label: getOptionLabel(value) }));

	const input = foundry.applications.fields.createSelectInput({
		name: "flags." + MOD_NAME + "." + flag_name,
		value: flags?.[MOD_NAME]?.[flag_name] ?? default_value,
		options
	});

	const formGroup = foundry.applications.fields.createFormGroup({
		input,
		label,
		hint: hint,
		localize: false
	});

	formGroup.classList.add("slim");
	parent.append(formGroup);
}

function createNumberInput({
	parent,
	app,
	flag_name,
	title,
	placeholder = null,
	default_value = null,
	step = null,
	hint
}) {
	const token = app.token ?? app.document;
	let flags = token.flags;
	if (flags === undefined) flags = token.data.flags;

	let value;
	if (flags?.[MOD_NAME]?.[flag_name]) {
		value = flags?.[MOD_NAME]?.[flag_name];
	} else if (default_value != null) {
		value = default_value;
	}
	const input = foundry.applications.fields.createNumberInput({
		name: "flags." + MOD_NAME + "." + flag_name,
		value,
		placeholder,
		step
	});

	const formGroup = foundry.applications.fields.createFormGroup({
		input,
		label: title,
		hint: hint,
		localize: false
	});

	formGroup.classList.add("slim");
	parent.append(formGroup);
}

function createCheckBox({ app, parent, data_name, title, hint }) {
	const token = app.token || app.document;

	const input = foundry.applications.fields.createCheckboxInput({
		name: "flags." + MOD_NAME + "." + data_name
	});
	input.setAttribute("data-dtype", "Boolean");
	if (token.getFlag(MOD_NAME, data_name)) {
		input.checked = "true";
	}

	const formGroup = foundry.applications.fields.createFormGroup({
		input,
		label: title,
		hint: hint,
		localize: false
	});

	parent.append(formGroup);
}

const swarmsRenderConfig = (objectName) => (app, html, data, options) => {
	if (!game.user.isGM) return;

	const doc = app.element?.ownerDocument || document;

	const tab = "appearance";

	if (options?.parts && !options.parts.includes(tab)) {
		return;
	}

	// Create a new field set
	const fieldSet = doc.createElement("fieldset");

	// Create a legend for this setting
	const legend = doc.createElement("legend");
	legend.textContent = "Swarm";
	fieldSet.append(legend);

	createCheckBox({
		app,
		parent: fieldSet,
		data_name: SWARM_FLAG,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.swarmEnabledTitle`),
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.swarmEnabledHint`, { objectName })
	});
	createNumberInput({
		app,
		parent: fieldSet,
		flag_name: SWARM_SIZE_FLAG,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.countTitle`),
		placeholder: DEFAULT_SWARM_SIZE,
		default_value: DEFAULT_SWARM_SIZE,
		step: 1,
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.countHint`)
	});
	createNumberInput({
		app,
		parent: fieldSet,
		flag_name: SWARM_SPEED_FLAG,
		title: game.i18n.format(`${LOCALIZATION_ROOT}.speedTitle`),
		placeholder: DEFAULT_SWARM_SPEED,
		default_value: DEFAULT_SWARM_SPEED,
		step: 0.1,
		hint: game.i18n.format(`${LOCALIZATION_ROOT}.speedHint`)
	});
	createSelect({
		app,
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
