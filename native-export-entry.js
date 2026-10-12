import { Filesystem, Directory } from '@capacitor/filesystem';

window.RDSNativeExport = {
  async saveFile(name, mimeType, base64) {
    const result = await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Documents,
      recursive: true
    });
    return { uri: result.uri || name, name, mimeType };
  }
};
