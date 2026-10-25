import asyncio,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
import server
class Request:
    async def json(self):return {'name':'Deck model v1'}
class ModelLibraryTests(unittest.TestCase):
    def test_names_persist_and_unknown_models_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);folder=root/'runs'/'example';folder.mkdir(parents=True)
            run={'id':'example','state':'complete','started':1,'models':{}}
            (folder/'status.json').write_text(json.dumps(run))
            with patch.object(server,'ROOT',root):
                asyncio.run(server.save_model('example',Request()))
                self.assertEqual(server.runs()[0]['name'],'Deck model v1')
                with self.assertRaises(HTTPException):server.completed_run('../other')
    def test_download_rejects_external_weights(self):
        run={'id':'example','state':'complete','models':{'labware':{'weights':str(Path('outside.pt').resolve())}}}
        with patch.object(server,'completed_run',return_value=run):
            with self.assertRaises(HTTPException):server.download_model('example')
if __name__=='__main__':unittest.main()
