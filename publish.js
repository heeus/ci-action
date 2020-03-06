/*
 * Copyright (c) 2020-present unTill Pro, Ltd. and Contributors
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
const fs = require('fs')
const path = require('path')
const tmp = require('tmp');
var admzip = require('adm-zip');
const execute = require('./common').execute
//const core = require('@actions/core')
const github = require('@actions/github')

function genVersion() {
	// UTC date-time as yyyyMMdd.HHmmss.SSS
	return new Date().toISOString().replace(/T/, '.').replace(/-|:|Z/g, '')
}

function prepareZip(source) {
	let zipFile = source
	const isDir = fs.lstatSync(source).isDirectory()
	if (isDir || path.extname(source) !== '.zip') {
		var zip = new admzip()
		if (isDir)
			zip.addLocalFolder(source)
		else
			zip.addLocalFile(source)
		zipFile = tmp.tmpNameSync({ postfix: '.zip' })
		zip.writeZip(zipFile)
	}
	return zipFile
}

const publishAsMavenArtifact = async function (artifact, token, repositoryOwner, repositoryName) {
	if (!fs.existsSync(artifact))
		throw { name: 'warning', message: `Artifact "${artifact}" is not found` }

	const zipFile = prepareZip(artifact)

	const version = genVersion()

	// Publish artifact to: com.github.${repositoryOwner}:${repositoryName}:${version}:zip
	await execute(`mvn deploy:deploy-file --batch-mode -DgroupId=com.github.${repositoryOwner} \
-DartifactId=${repositoryName} -Dversion=${version} -DgeneratePom=true \
-DrepositoryId=GitHubPackages -Durl=https://x-oauth-basic:${token}@maven.pkg.github.com/${repositoryOwner}/${repositoryName} -Dfile="${zipFile}"`)

	if (zipFile !== artifact)
		fs.unlinkSync(zipFile)
}

const publishAsRelease = async function (asset, token, repositoryOwner, repositoryName, targetCommitish) {
	if (!fs.existsSync(asset))
		throw { name: 'warning', message: `Asset "${asset}" is not found` }

	if (!fs.existsSync('deployer.url'))
		throw { name: 'warning', message: `File "deployer.url" missing` }

	const version = genVersion()
	const zipFile = prepareZip(asset)
	const octokit = new github.GitHub(token);

	// Create release (+tag)
	const createReleaseResponse = await octokit.repos.createRelease({
		owner: repositoryOwner,
		repo: repositoryName,
		tag_name: version,
		target_commitish: targetCommitish,
		name: version,
	})
	console.log(`Release ID: ${createReleaseResponse.data.id}`)
	console.log(`Release URL: ${createReleaseResponse.data.html_url}`)

	// Upload asset
	const headers = {
		'content-type': 'application/zip',
		'content-length': fs.statSync(zipFile).size
	};
	const uploadAssetResponse = await octokit.repos.uploadReleaseAsset({
		url: createReleaseResponse.data.upload_url,
		headers,
		name: `${repositoryName}-${version}.zip`,
		file: fs.readFileSync(zipFile),
	});

	console.log(`Release asset URL: ${uploadAssetResponse.data.browser_download_url}`)

	if (zipFile !== asset)
		fs.unlinkSync(zipFile)

	// get repo list
	const releases = await octokit.repos.listReleases({
		owner: repositoryOwner,
		repo: repositoryName,
	})

	// Remove old releases (with tag)
	releases.data
		.filter(release => /^\d{8}\.\d{6}\.\d{3}$/.test(release.name)
			&& release.tag_name === release.name)
		.sort((a, b) => (b.name > a.name) ? 1 : ((a.name > b.name) ? -1 : 0))
		.slice(5) // XXX Hard-coded
		.forEach(release => {
			console.log(`Remove release ${release.name}`)
			octokit.repos.deleteRelease({
				owner: repositoryOwner,
				repo: repositoryName,
				release_id: release.id,
			})
			octokit.git.deleteRef({
				owner: repositoryOwner,
				repo: repositoryName,
				ref: `tags/${release.tag_name}`,
			})
		})
}

module.exports = {
	publishAsMavenArtifact,
	publishAsRelease
}

async function main() {
	try {
		await publishAsRelease('asset.zip', '75f0a1ce307290922cba746741695b52e197360c', 'vitkud', 'ci-action', '5ed187007d6057525067e10a9820288694cb5916')
	} catch (error) {
		if (error.name !== 'warning') {
			console.error(error)
		}
		console.log(error.message)
	}
}

main()