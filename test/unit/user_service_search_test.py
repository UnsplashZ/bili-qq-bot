import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from src.services.bili_server_core.services import user_service


class UserServiceSearchTest(unittest.IsolatedAsyncioTestCase):
    async def test_search_users_should_pass_group_credential_when_api_supports_it(self):
        with (
            patch.object(user_service, '_get_search_users_auth_param_name', return_value='credential'),
            patch.object(user_service, 'load_credential', return_value='cred-1000') as load_credential,
            patch.object(
                user_service.search,
                'search_by_type',
                AsyncMock(return_value={'result': [], 'numResults': 0}),
            ) as search_by_type,
        ):
            result = await user_service.search_users('测试UP', group_id='1000', page=2, page_size=6)

        self.assertEqual(result['status'], 'success')
        load_credential.assert_called_once_with('1000')
        search_by_type.assert_awaited_once_with(
            '测试UP',
            user_service.search.SearchObjectType.USER,
            page=2,
            page_size=6,
            credential='cred-1000',
        )

    async def test_search_users_should_skip_group_credential_when_api_does_not_support_it(self):
        with (
            patch.object(user_service, '_get_search_users_auth_param_name', return_value=None),
            patch.object(user_service, 'load_credential') as load_credential,
            patch.object(
                user_service.search,
                'search_by_type',
                AsyncMock(return_value={'result': [], 'numResults': 0}),
            ) as search_by_type,
        ):
            result = await user_service.search_users('测试UP', group_id='1000', page=1, page_size=5)

        self.assertEqual(result['status'], 'success')
        load_credential.assert_not_called()
        search_by_type.assert_awaited_once_with(
            '测试UP',
            user_service.search.SearchObjectType.USER,
            page=1,
            page_size=5,
        )

    async def test_search_users_should_tolerate_malformed_candidates(self):
        malformed_result = {
            'result': [
                'not-a-dict',
                {
                    'mid': 42,
                    'uname': '测试UP',
                    'official_verify': 'verified',
                    'fans': 123,
                },
                {
                    'mid': 84,
                    'uname': '另一个UP',
                    'official_verify': {
                        'type': '1',
                        'desc': 404,
                    },
                    'is_live': 1,
                },
            ],
            'numResults': 3,
        }

        with (
            patch.object(user_service, '_get_search_users_auth_param_name', return_value=None),
            patch.object(
                user_service.search,
                'search_by_type',
                AsyncMock(return_value=malformed_result),
            ),
        ):
            result = await user_service.search_users('测试UP', group_id='1000')

        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['data']['total'], 3)
        self.assertEqual(result['data']['candidates'], [
            {
                'uid': 42,
                'name': '测试UP',
                'sign': '',
                'avatar': '',
                'fans': 123,
                'videos': 0,
                'room_id': 0,
                'level': 0,
                'official_verify_type': -1,
                'official_verify_desc': '',
                'is_live': False,
                'is_upuser': False,
            },
            {
                'uid': 84,
                'name': '另一个UP',
                'sign': '',
                'avatar': '',
                'fans': 0,
                'videos': 0,
                'room_id': 0,
                'level': 0,
                'official_verify_type': 1,
                'official_verify_desc': '404',
                'is_live': True,
                'is_upuser': False,
            },
        ])


if __name__ == '__main__':
    unittest.main()
