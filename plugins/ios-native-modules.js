const { withXcodeProject, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const sources = ['KeyBackupModule', 'DeviceCapabilitiesModule', 'AudioTranscodeModule']
    .flatMap((name) => [`${name}.swift`, `${name}.m`]);

const addNativeSources = (project) => {
    const target = project.getFirstTarget().uuid;
    const group = project.findPBXGroupKey({ name: 'VaultoNote' });
    if (!group) throw new Error('VaultoNote Xcode source group is missing');
    for (const name of sources) {
        const source = `../native/ios/${name}`;
        if (project.hasFile(source)) continue;
        const file = project.addSourceFile(source, { target }, group);
        const reference = project.pbxFileReferenceSection()[file.fileRef];
        reference.sourceTree = 'SOURCE_ROOT';
        delete reference.explicitFileType;
    }
    return project;
};

const withNativeModules = (config) => {
    config = withXcodeProject(config, (result) => {
        addNativeSources(result.modResults);
        return result;
    });
    return withDangerousMod(config, ['ios', async (result) => {
        const header = path.join(result.modRequest.platformProjectRoot, 'VaultoNote/VaultoNote-Bridging-Header.h');
        const contents = fs.readFileSync(header, 'utf8');
        if (!contents.includes('<React/RCTBridgeModule.h>')) {
            fs.writeFileSync(header, `${contents}\n#import <React/RCTBridgeModule.h>\n`);
        }
        return result;
    }]);
};

module.exports = createRunOncePlugin(withNativeModules, 'vaulto-ios-native-modules', '1.0.0');
module.exports.addNativeSources = addNativeSources;
